import { spawn } from 'node:child_process';
import { access, constants, mkdtemp, readFile, rm } from 'node:fs/promises';
import type { Socket } from 'node:net';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { build } from 'tsdown';
import { afterAll, beforeAll, expect, test } from 'vitest';

// Smoke test of the production build: tsdown.config.ts is built into a temp dir (never the real
// dist), then the files are run under Node exactly as `flux` and `flux-mcp` are after
// install. Nothing here needs a relay or an agent; the daemon commands exercised open the data
// dir (SQLite, box keypair, VAPID key) and stop. A fake control socket stands in for the daemon
// to show that a misbehaving daemon is reported, not crashed on.

const daemonDir = fileURLToPath(new URL('..', import.meta.url));
let outDir: string;
let dataDir: string;

interface Exit {
  code: number | null;
  stdout: string;
  stderr: string;
}

const runFlux = (args: string[], env: Record<string, string>): Promise<Exit> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [join(outDir, 'index.mjs'), ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });

// A daemon stand-in on the control socket path that does `behave` to each connection. Closing
// destroys whatever connection is still half-open, so `close` cannot wait on the peer.
interface FakeDaemon {
  close: () => Promise<void>;
}

const fakeDaemon = (path: string, behave: (socket: Socket) => void): Promise<FakeDaemon> =>
  new Promise((resolve) => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.once('close', () => {
        sockets.delete(socket);
      });
      behave(socket);
    });
    const close = (): Promise<void> =>
      new Promise((_resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          _resolve();
        });
      });
    server.listen(path, () => {
      resolve({ close });
    });
  });

interface Mcp {
  next: () => Promise<unknown>;
  send: (message: object) => void;
  kill: () => void;
}

const startMcp = (socketPath: string): Mcp => {
  const child = spawn(process.execPath, [join(outDir, 'flux-mcp.mjs')], {
    env: { FLUX_CONTROL_SOCKET: socketPath, FLUX_SESSION: 's1' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const reader = createInterface({ input: child.stdout });
  return {
    next: () =>
      new Promise((resolve) => {
        reader.once('line', (line) => {
          resolve(JSON.parse(line));
        });
      }),
    send: (message) => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    },
    kill: () => {
      child.kill();
    },
  };
};

const notify = { name: 'flux_notify', arguments: { summary: 'x', level: 'info' } };

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'flux-dist-'));
  dataDir = await mkdtemp(join(tmpdir(), 'flux-data-'));
  await build({
    config: join(daemonDir, 'tsdown.config.ts'),
    cwd: daemonDir,
    outDir,
    clean: false,
    logLevel: 'silent',
  });
});

afterAll(async () => {
  await rm(outDir, { recursive: true, force: true });
  await rm(dataDir, { recursive: true, force: true });
});

test('the build is flux, flux-mcp, flux-manager-mcp and the pi extension, resolved beside each other', async () => {
  await access(join(outDir, 'index.mjs'), constants.X_OK);
  await access(join(outDir, 'flux-mcp.mjs'), constants.X_OK);
  await access(join(outDir, 'flux-manager-mcp.mjs'), constants.X_OK);
  const flux = await readFile(join(outDir, 'index.mjs'), 'utf8');
  const mcp = await readFile(join(outDir, 'flux-mcp.mjs'), 'utf8');
  const manager = await readFile(join(outDir, 'flux-manager-mcp.mjs'), 'utf8');
  expect(flux.startsWith('#!/usr/bin/env node\n')).toBe(true);
  expect(mcp.startsWith('#!/usr/bin/env node\n')).toBe(true);
  expect(manager.startsWith('#!/usr/bin/env node\n')).toBe(true);
  expect(flux).toContain('./flux-mcp.mjs');
  // A manager session's .mcp.json points here as a sibling of index.mjs (ADR 0025).
  expect(flux).toContain('./flux-manager-mcp.mjs');
  expect(flux).toContain('./flux-pi-extension.mjs');
  // The extension is loaded by pi (jiti) from wherever dist lives: no workspace or relative
  // imports may survive bundling, and its default export must register the two Flux tools.
  const extension = await readFile(join(outDir, 'flux-pi-extension.mjs'), 'utf8');
  expect(extension).not.toContain('@flux/');
  expect(extension).not.toMatch(/from\s+["']\.{1,2}\//u);
  const loaded = (await import(join(outDir, 'flux-pi-extension.mjs'))) as {
    default: (pi: { registerTool: (t: { name: string }) => void }) => void;
  };
  const names: string[] = [];
  loaded.default({
    registerTool: (tool) => {
      names.push(tool.name);
    },
  });
  expect(names).toEqual(['flux_ask', 'flux_notify']);
});

test('flux daemon refuses to start without FLUX_RELAY_URL', async () => {
  const exit = await runFlux(['daemon'], { HOME: dataDir });
  expect(exit.code).toBe(2);
  expect(exit.stderr).toContain('FLUX_RELAY_URL is required');
});

test('flux devices ls needs no relay URL, opens a fresh data dir and exits cleanly', async () => {
  const env = { HOME: dataDir, FLUX_DATA_DIR: dataDir };
  const exit = await runFlux(['devices', 'ls'], env);
  expect(exit).toEqual({ code: 0, stdout: '', stderr: '' });
  await access(join(dataDir, 'flux.sqlite'));
  const unknown = await runFlux(['bogus'], env);
  expect(unknown.code).toBe(2);
  expect(unknown.stderr).toContain('unknown command bogus');
});

test('flux devices rm goes through a running daemon and falls back to the database', async () => {
  const env = { HOME: dataDir, FLUX_DATA_DIR: dataDir };
  const socketPath = join(dataDir, 'control.sock');
  const lines: string[] = [];
  const live = await fakeDaemon(socketPath, (socket) => {
    socket.once('data', (chunk: Buffer) => {
      lines.push(chunk.toString());
      socket.end('{"ok":true,"result":{}}\n');
    });
  });
  const viaDaemon = await runFlux(['devices', 'rm', 'dev-1'], env);
  await live.close();
  expect(viaDaemon).toEqual({ code: 0, stdout: 'removed dev-1\n', stderr: '' });
  expect(lines).toEqual(['{"type":"devices.rm","deviceId":"dev-1"}\n']);
  const noDaemon = await runFlux(['devices', 'rm', 'dev-1'], env);
  expect(noDaemon.code).toBe(1);
  expect(noDaemon.stderr).toContain('no device dev-1');
});

test('flux pair reports a missing daemon, one that hangs up, and one that talks rubbish', async () => {
  const env = { HOME: dataDir, FLUX_DATA_DIR: dataDir };
  const missing = await runFlux(['pair'], env);
  expect(missing.code).toBe(1);
  expect(missing.stderr).toContain('no running daemon');

  const socketPath = join(dataDir, 'control.sock');
  const hangsUp = await fakeDaemon(socketPath, (socket) => {
    socket.end();
  });
  const closed = await runFlux(['pair'], env);
  await hangsUp.close();
  expect(closed.code).toBe(1);
  expect(closed.stderr).toContain('daemon closed without replying');

  const rubbish = await fakeDaemon(socketPath, (socket) => {
    socket.end('not json\n');
  });
  const garbage = await runFlux(['pair'], env);
  await rubbish.close();
  expect(garbage.code).toBe(1);
  expect(garbage.stderr).toContain('unreadable reply');
});

test('flux-mcp initializes and reports a missing, silent or rubbish daemon per call', async () => {
  const socketPath = join(dataDir, 'mcp.sock');
  const mcp = startMcp(socketPath);
  mcp.send({ id: 1, method: 'initialize', params: {} });
  expect(await mcp.next()).toMatchObject({ id: 1, result: { serverInfo: { name: 'flux' } } });

  mcp.send({ id: 2, method: 'tools/call', params: notify });
  expect(await mcp.next()).toMatchObject({
    id: 2,
    result: { isError: true, content: [{ text: expect.stringContaining('unreachable') }] },
  });

  const hangsUp = await fakeDaemon(socketPath, (socket) => {
    socket.end();
  });
  mcp.send({ id: 3, method: 'tools/call', params: notify });
  expect(await mcp.next()).toMatchObject({
    id: 3,
    result: { isError: true, content: [{ text: 'flux daemon closed without replying' }] },
  });
  await hangsUp.close();

  const rubbish = await fakeDaemon(socketPath, (socket) => {
    socket.end('not json\n');
  });
  mcp.send({ id: 4, method: 'tools/call', params: notify });
  expect(await mcp.next()).toMatchObject({
    id: 4,
    result: { isError: true, content: [{ text: 'flux daemon sent an unreadable reply' }] },
  });
  await rubbish.close();

  mcp.send({ id: 5, method: 'ping' });
  expect(await mcp.next()).toEqual({ jsonrpc: '2.0', id: 5, result: {} });
  mcp.kill();
});

interface Running {
  child: ReturnType<typeof spawn>;
  exit: Promise<Exit>;
  firstLine: Promise<string>;
}

// The built daemon, left running: resolves once it has printed its first line.
const startDaemon = (env: Record<string, string>): Running => {
  const child = spawn(process.execPath, [join(outDir, 'index.mjs'), 'daemon'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  const firstLine = new Promise<string>((resolve) => {
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
      const end = stdout.indexOf('\n');
      if (end !== -1) resolve(stdout.slice(0, end));
    });
  });
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  const exit = new Promise<Exit>((resolve) => {
    child.once('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
  return { child, exit, firstLine };
};

test('a second flux daemon on the same data dir refuses with exit 3; SIGTERM stops the first', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flux-two-'));
  // The relay is never reached: the transport retries in the background and stop() ends it.
  const env = { HOME: dir, FLUX_DATA_DIR: dir, FLUX_RELAY_URL: 'http://127.0.0.1:9', PATH: '' };
  const first = startDaemon(env);
  expect(await first.firstLine).toBe('flux daemon: relay http://127.0.0.1:9');
  const second = await runFlux(['daemon'], env);
  expect(second.code).toBe(3);
  expect(second.stderr).toContain(`another flux daemon (pid ${first.child.pid}) holds`);
  first.child.kill('SIGTERM');
  const exit = await first.exit;
  expect(exit.code).toBe(0);
  expect(exit.stderr).toContain('SIGTERM, stopping');
  await expect(access(join(dir, 'daemon.lock'))).rejects.toThrow('ENOENT');
  await rm(dir, { recursive: true, force: true });
});
