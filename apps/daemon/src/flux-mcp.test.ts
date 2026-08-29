import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';

import type { ControlRequest, ControlSocket } from './create-control-socket.ts';
import { createControlSocket } from './create-control-socket.ts';

// The real MCP binary as a child process, speaking JSON-RPC over stdio, against a real control
// socket whose handler the test controls.

const binary = fileURLToPath(new URL('./flux-mcp.ts', import.meta.url));
let socketPath: string;
let control: ControlSocket;
let requests: ControlRequest[];

beforeEach(async () => {
  socketPath = join(await mkdtemp(join(tmpdir(), 'flux-mcp-')), 'control.sock');
  requests = [];
  control = createControlSocket({
    path: socketPath,
    handle: (request) => {
      requests.push(request);
      if (request.type === 'ask') return Promise.resolve({ answer: 'ship it', by: 'device' });
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
  notify: (method: string) => void;
  close: () => void;
}

const start = (): Server => {
  const child = spawn(process.execPath, [binary], {
    env: { ...process.env, FLUX_CONTROL_SOCKET: socketPath, FLUX_SESSION: 's1' },
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
    notify: (method) => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
    },
    close: () => {
      child.stdin.end();
      child.kill();
    },
  };
};

test('initializes, lists both tools and forwards calls to the control socket', async () => {
  const server = start();
  const init = await server.call('initialize', { protocolVersion: '2024-11-05' });
  expect(init['result']).toMatchObject({
    protocolVersion: '2024-11-05',
    serverInfo: { name: 'flux' },
  });
  server.notify('notifications/initialized');
  const list = await server.call('tools/list');
  const tools = (list['result'] as { tools: { name: string }[] }).tools.map((t) => t.name);
  expect(tools).toEqual(['flux_ask', 'flux_notify']);
  const asked = await server.call('tools/call', {
    name: 'flux_ask',
    arguments: { question: 'deploy?', options: ['yes', 'no'] },
  });
  expect(asked['result']).toEqual({ content: [{ type: 'text', text: 'ship it' }] });
  const notified = await server.call('tools/call', {
    name: 'flux_notify',
    arguments: { summary: 'all green', level: 'done' },
  });
  expect(notified['result']).toEqual({ content: [{ type: 'text', text: 'noted' }] });
  expect(requests).toEqual([
    { type: 'ask', session: 's1', question: 'deploy?', options: ['yes', 'no'] },
    { type: 'notify', session: 's1', summary: 'all green', level: 'done' },
  ]);
  expect(await server.call('ping')).toMatchObject({ result: {} });
  server.close();
});

test('unknown tools and methods are reported, not fatal', async () => {
  const server = start();
  const bad = await server.call('tools/call', { name: 'nope', arguments: {} });
  expect(bad['result']).toMatchObject({ isError: true });
  const missing = await server.call('no/such');
  expect(missing['error']).toMatchObject({ code: -32601 });
  const stillAlive = await server.call('ping');
  expect(stillAlive['result']).toEqual({});
  server.close();
});
