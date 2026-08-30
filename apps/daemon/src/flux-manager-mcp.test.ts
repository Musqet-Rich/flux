import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';

import type { ControlRequest, ControlSocket } from './create-control-socket.ts';
import { createControlSocket } from './create-control-socket.ts';

// The real manager MCP binary as a child process, speaking JSON-RPC over stdio against a real
// control socket whose handler the test controls (mirrors flux-mcp.test.ts). Every forwarded
// control request must pass the socket's own guard, so this also proves the tools build valid
// requests.

const binary = fileURLToPath(new URL('./flux-manager-mcp.ts', import.meta.url));
let socketPath: string;
let control: ControlSocket;
let requests: ControlRequest[];

beforeEach(async () => {
  socketPath = join(await mkdtemp(join(tmpdir(), 'flux-mgr-mcp-')), 'control.sock');
  requests = [];
  control = createControlSocket({
    path: socketPath,
    handle: (request) => {
      requests.push(request);
      if (request.type === 'sessions.list') {
        return Promise.resolve({
          sessions: [
            {
              session: 's2',
              title: 'Worker',
              harness: 'claude',
              state: 'idle',
              repo: '/r',
              branch: 'b',
            },
          ],
        });
      }
      if (request.type === 'session.open')
        return Promise.resolve({ session: 'new1', title: 'Sub' });
      if (request.type === 'session.send') return Promise.resolve({ seq: 7 });
      if (request.type === 'session.read') return Promise.resolve({ digest: 'user: hi', count: 1 });
      return Promise.resolve({});
    },
  });
  await control.listen();
});

afterEach(async () => {
  await control.close();
});

interface Server {
  call: (method: string, params?: unknown, id?: number) => Promise<Record<string, unknown>>;
  close: () => void;
}

const start = (): Server => {
  const child = spawn(process.execPath, [binary], {
    env: { ...process.env, FLUX_CONTROL_SOCKET: socketPath, FLUX_SESSION: 'm1' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const waiters = new Map<number, (reply: Record<string, unknown>) => void>();
  createInterface({ input: child.stdout }).on('line', (line) => {
    const reply: Record<string, unknown> = JSON.parse(line);
    waiters.get(Number(reply['id']))?.(reply);
  });
  let nextId = 1;
  return {
    call: (method, params = {}, id = nextId++) =>
      new Promise((resolve) => {
        waiters.set(id, resolve);
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      }),
    close: () => {
      child.stdin.end();
      child.kill();
    },
  };
};

const text = (reply: Record<string, unknown>): string => {
  const result = reply['result'] as { content: { text: string }[] };
  return result.content[0]?.text ?? '';
};

test('advertises the five manager tools and forwards list and open', async () => {
  const server = start();
  const init = await server.call('initialize', { protocolVersion: '2024-11-05' });
  expect(init['result']).toMatchObject({ serverInfo: { name: 'flux-manager' } });
  const list = await server.call('tools/list');
  const tools = (list['result'] as { tools: { name: string }[] }).tools.map((t) => t.name);
  expect(tools).toEqual([
    'flux_sessions_list',
    'flux_session_open',
    'flux_session_send',
    'flux_session_close',
    'flux_session_read',
  ]);
  const listed = await server.call('tools/call', { name: 'flux_sessions_list', arguments: {} });
  expect(text(listed)).toContain('s2');
  expect(text(listed)).toContain('Worker');
  const opened = await server.call('tools/call', {
    name: 'flux_session_open',
    arguments: { repo: '/r', branch: 'feat', harness: 'claude', title: 'Sub' },
  });
  expect(text(opened)).toBe('Opened session new1 (Sub)');
  expect(requests).toEqual([
    { type: 'sessions.list', session: 'm1' },
    {
      type: 'session.open',
      session: 'm1',
      repo: '/r',
      branch: 'feat',
      harness: 'claude',
      title: 'Sub',
    },
  ]);
  server.close();
});

test('forwards send, close and read to the control socket with readable results', async () => {
  const server = start();
  const sent = await server.call('tools/call', {
    name: 'flux_session_send',
    arguments: { target: 's2', text: 'go' },
  });
  expect(text(sent)).toBe('Sent to s2 (seq 7)');
  const closed = await server.call('tools/call', {
    name: 'flux_session_close',
    arguments: { target: 's2' },
  });
  expect(text(closed)).toContain('Archived s2');
  const read = await server.call('tools/call', {
    name: 'flux_session_read',
    arguments: { target: 's2', limit: 5 },
  });
  expect(text(read)).toBe('user: hi');
  expect(requests).toEqual([
    { type: 'session.send', session: 'm1', target: 's2', text: 'go' },
    { type: 'session.close', session: 'm1', target: 's2' },
    { type: 'session.read', session: 'm1', target: 's2', limit: 5 },
  ]);
  server.close();
});

test('a daemon-side rejection is surfaced as an error result, not a crash', async () => {
  const server = start();
  const bad = await server.call('tools/call', { name: 'nope', arguments: {} });
  expect(bad['result']).toMatchObject({ isError: true });
  const stillAlive = await server.call('ping');
  expect(stillAlive['result']).toEqual({});
  server.close();
});
