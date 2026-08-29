import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { build } from 'tsdown';
import { beforeAll, expect, test } from 'vitest';

// Smoke test of the production build: tsdown.config.ts is built into a temp dir (never the real
// dist), then the two files are run under Node exactly as `flux` and `flux-mcp` are after
// install. Nothing here needs a relay or an agent; the daemon commands exercised open the data
// dir (SQLite, box keypair, VAPID key) and stop.

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

test('the build is two files and flux resolves flux-mcp beside itself', async () => {
  await access(join(outDir, 'flux-mcp.mjs'));
  const flux = await readFile(join(outDir, 'index.mjs'), 'utf8');
  expect(flux.startsWith('#!/usr/bin/env node\n')).toBe(true);
  expect(flux).toContain('./flux-mcp.mjs');
});

test('flux refuses to start without FLUX_RELAY_URL', async () => {
  const exit = await runFlux(['daemon'], { HOME: dataDir });
  expect(exit.code).toBe(2);
  expect(exit.stderr).toContain('FLUX_RELAY_URL is required');
});

test('flux pair needs no relay URL, only a running daemon', async () => {
  const exit = await runFlux(['pair'], { HOME: dataDir, FLUX_DATA_DIR: dataDir });
  expect(exit.code).toBe(1);
  expect(exit.stderr).toContain('no running daemon');
});

test('flux devices ls opens a fresh data dir and exits cleanly', async () => {
  const env = { HOME: dataDir, FLUX_DATA_DIR: dataDir, FLUX_RELAY_URL: 'https://relay.invalid' };
  const exit = await runFlux(['devices', 'ls'], env);
  expect(exit).toEqual({ code: 0, stdout: '', stderr: '' });
  await access(join(dataDir, 'flux.sqlite'));
  const unknown = await runFlux(['bogus'], env);
  expect(unknown.code).toBe(2);
  expect(unknown.stderr).toContain('unknown command bogus');
});

test('flux-mcp answers initialize and survives a tool call with no daemon', async () => {
  const child = spawn(process.execPath, [join(outDir, 'flux-mcp.mjs')], {
    env: { FLUX_CONTROL_SOCKET: join(dataDir, 'none.sock'), FLUX_SESSION: 's1' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const lines: string[] = [];
  const reader = createInterface({ input: child.stdout });
  const next = (): Promise<unknown> =>
    new Promise((resolve) => {
      reader.once('line', (line) => {
        lines.push(line);
        resolve(JSON.parse(line));
      });
    });
  child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
  expect(await next()).toMatchObject({ id: 1, result: { serverInfo: { name: 'flux' } } });
  const call = { name: 'flux_notify', arguments: { summary: 'x', level: 'info' } };
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: call })}\n`,
  );
  expect(await next()).toMatchObject({ id: 2, result: { isError: true } });
  child.stdin.write('{"jsonrpc":"2.0","id":3,"method":"ping"}\n');
  expect(await next()).toEqual({ jsonrpc: '2.0', id: 3, result: {} });
  child.kill();
  expect(lines).toHaveLength(3);
});
