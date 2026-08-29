import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';

import type { RelayServer } from './create-relay-server.ts';
import { createRelayServer } from './create-relay-server.ts';

// Real server, real sockets, ephemeral port (engineering.md § Testing). The client is the
// platform WebSocket; `ws` is server side only.

const room = 'AAAAAAAAAAAAAAAAAAAAAA';
let server: RelayServer;
let port: number;
let pwaDir: string;

beforeEach(async () => {
  pwaDir = await mkdtemp(join(tmpdir(), 'flux-relay-'));
  await writeFile(join(pwaDir, 'index.html'), '<!doctype html><title>flux</title>');
  await writeFile(join(pwaDir, 'app.js'), 'console.log(1)');
  server = createRelayServer({ pwaDir, maxGuests: 2, maxFrameBytes: 64, joinTimeoutMs: 100 });
  port = await server.listen(0);
});

afterEach(async () => {
  await server.close();
});

interface Client {
  socket: WebSocket;
  next: () => Promise<string | Uint8Array>;
  closed: Promise<number>;
}

const asBytes = (data: unknown): Uint8Array => {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new Error('unexpected message type');
};

const connect = (path = `/ws/${room}`): Promise<Client> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    socket.binaryType = 'arraybuffer';
    const queue: (string | Uint8Array)[] = [];
    const waiters: ((m: string | Uint8Array) => void)[] = [];
    socket.addEventListener('message', (event) => {
      const data: unknown = event.data;
      const message = typeof data === 'string' ? data : asBytes(data);
      const waiter = waiters.shift();
      if (waiter) waiter(message);
      else queue.push(message);
    });
    const closed = new Promise<number>((_resolve) => {
      socket.addEventListener('close', (event) => {
        _resolve(event.code);
      });
    });
    const next = (): Promise<string | Uint8Array> =>
      new Promise((_resolve) => {
        const queued = queue.shift();
        if (queued === undefined) waiters.push(_resolve);
        else _resolve(queued);
      });
    socket.addEventListener('open', () => {
      resolve({ socket, next, closed });
    });
    socket.addEventListener('error', () => {
      reject(new Error('connect failed'));
    });
  });

const joined = async (client: Client, request: object): Promise<string | Uint8Array> => {
  client.socket.send(JSON.stringify(request));
  return client.next();
};

const host = { v: 1, role: 'host', token: 'tok' };
const guest = { v: 1, role: 'guest' };

test('serves the PWA with security headers and a SPA fallback', async () => {
  const index = await fetch(`http://127.0.0.1:${port}/`);
  expect(index.status).toBe(200);
  expect(await index.text()).toContain('flux');
  expect(index.headers.get('content-security-policy')).toContain("default-src 'self'");
  expect(index.headers.get('x-content-type-options')).toBe('nosniff');
  const asset = await fetch(`http://127.0.0.1:${port}/app.js`);
  expect(asset.headers.get('content-type')).toContain('javascript');
  const deep = await fetch(`http://127.0.0.1:${port}/session/abc`);
  expect(deep.status).toBe(200);
  expect(await deep.text()).toContain('flux');
  const health = await fetch(`http://127.0.0.1:${port}/healthz`);
  expect(await health.json()).toEqual({ ok: true });
});

test('host and guest join, frames fan out both ways', async () => {
  const h = await connect();
  const g = await connect();
  expect(await joined(h, host)).toBe('{"ok":true}');
  expect(await joined(g, guest)).toBe('{"ok":true}');
  h.socket.send(new Uint8Array([2, 1, 2, 3]));
  expect(await g.next()).toEqual(new Uint8Array([2, 1, 2, 3]));
  g.socket.send(new Uint8Array([2, 9]));
  expect(await h.next()).toEqual(new Uint8Array([2, 9]));
});

test('a guest without a host is told so, then learns when one joins', async () => {
  const g = await connect();
  expect(await joined(g, guest)).toBe('{"ok":true}');
  g.socket.send(new Uint8Array([2]));
  expect(await g.next()).toBe('{"type":"no_host"}');
  const h = await connect();
  expect(await joined(h, host)).toBe('{"ok":true}');
  expect(await g.next()).toBe('{"type":"host_joined"}');
  h.socket.close();
  expect(await g.next()).toBe('{"type":"host_left"}');
});

test('join errors are reported then the socket is closed', async () => {
  const h = await connect();
  expect(await joined(h, host)).toBe('{"ok":true}');
  const second = await connect();
  expect(await joined(second, host)).toBe('{"ok":false,"error":"host_present"}');
  expect(await second.closed).toBe(1008);
  const g1 = await connect();
  const g2 = await connect();
  const g3 = await connect();
  await joined(g1, guest);
  await joined(g2, guest);
  expect(await joined(g3, guest)).toBe('{"ok":false,"error":"room_full"}');
  const old = await connect();
  expect(await joined(old, { v: 2, role: 'guest' })).toBe('{"ok":false,"error":"bad_version"}');
});

test('a malformed or binary first message ends the connection', async () => {
  const text = await connect();
  text.socket.send('not json');
  expect(await text.closed).toBe(1002);
  const binary = await connect();
  binary.socket.send(new Uint8Array([1]));
  expect(await binary.closed).toBe(1002);
});

test('text after the join and oversize frames end the connection', async () => {
  const h = await connect();
  await joined(h, host);
  h.socket.send('hello');
  expect(await h.closed).toBe(1002);
  const g = await connect();
  await joined(g, guest);
  g.socket.send(new Uint8Array(65));
  expect(await g.closed).toBe(1009);
});

test('a silent connection is dropped after the join timeout', async () => {
  const c = await connect();
  expect(await c.closed).toBe(1008);
});

test('bad room paths never upgrade', async () => {
  await expect(connect('/ws/short')).rejects.toThrow('connect failed');
  await expect(connect('/other')).rejects.toThrow('connect failed');
});
