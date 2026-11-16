import type { Bytes, Channel, Wire } from '@flux/protocol';
import { bytes, handshake } from '@flux/protocol';
import type { AddressInfo } from 'node:net';
import { channel as diagnosticsChannel } from 'node:diagnostics_channel';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { WebSocket as ServerSocket } from 'ws';
import { WebSocketServer } from 'ws';

import { deviceHandshake } from '../test/device-side.ts';
import { createDeviceChannels } from './create-device-channels.ts';
import type { TransportStatus } from './create-host-transport.ts';
import { createHostTransport } from './create-host-transport.ts';

// A minimal fake relay: accepts the host join and then plays the guest itself, so the test can
// exercise the full path socket → channels → handshake → rpc → reply → socket.

const roomId = 'AAAAAAAAAAAAAAAAAAAAAA';
let server: WebSocketServer;
let port: number;
let hosts: ServerSocket[];
let joins: string[];

beforeEach(async () => {
  server = new WebSocketServer({ port: 0 });
  hosts = [];
  joins = [];
  server.on('connection', (socket) => {
    socket.once('message', (data) => {
      joins.push(Buffer.from(data as Buffer).toString());
      hosts.push(socket);
      socket.send(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => {
    server.once('listening', resolve);
  });
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  vi.useRealTimers();
  for (const socket of server.clients) socket.terminate();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

// Resolves with the newest host socket once at least `count` hosts have joined.
const untilHosts = (count: number): Promise<ServerSocket> =>
  new Promise((resolve) => {
    const check = (): void => {
      const socket = hosts.at(-1);
      if (socket && hosts.length >= count) resolve(socket);
      else setImmediate(check);
    };
    check();
  });

const plain = async (channel: Channel, data: Bytes): Promise<unknown> =>
  JSON.parse(bytes.toUtf8((await channel.open(data)) ?? new Uint8Array()));

const frames = (socket: ServerSocket): (() => Promise<Bytes>) => {
  const queue: Bytes[] = [];
  const waiters: ((b: Bytes) => void)[] = [];
  socket.on('message', (data, isBinary) => {
    if (!isBinary) return;
    const chunk = new Uint8Array(
      Buffer.isBuffer(data)
        ? data
        : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data)]),
    );
    const waiter = waiters.shift();
    if (waiter) waiter(chunk);
    else queue.push(chunk);
  });
  return () =>
    new Promise((resolve) => {
      const queued = queue.shift();
      if (queued) resolve(queued);
      else waiters.push(resolve);
    });
};

// Resolves once `wanted` has been reported at least `times` times.
const untilStatus = (
  statuses: TransportStatus[],
  wanted: TransportStatus,
  times = 1,
): Promise<void> =>
  new Promise((resolve) => {
    const check = (): void => {
      if (statuses.filter((s) => s === wanted).length >= times) resolve();
      else setImmediate(check);
    };
    check();
  });

const setup = async (relaySilenceMs?: number) => {
  const box = await handshake.generateKeyPair(true);
  const dev = await handshake.generateKeyPair(true);
  const received: Wire[] = [];
  const channels = createDeviceChannels({
    identity: { publicKey: box.publicKey, privateKey: box.privateKey },
    deviceByKey: () => ({
      deviceId: 'd1',
      publicKey: dev.publicKey,
      name: 'n',
      pairedAt: 't',
      lastSeenAt: null,
    }),
    pairingOpen: () => false,
    onMessage: (_peer, message) => {
      received.push(message);
      return Promise.resolve(
        message.kind === 'rpc'
          ? { kind: 'rpc.result', id: message.id, ok: true, result: null }
          : null,
      );
    },
  });
  const statuses: TransportStatus[] = [];
  const transport = createHostTransport({
    relayUrl: `http://127.0.0.1:${port}`,
    roomId,
    token: 'tok',
    channels,
    minBackoffMs: 10,
    maxBackoffMs: 20,
    ...(relaySilenceMs === undefined ? {} : { relaySilenceMs }),
    onStatus: (status) => {
      statuses.push(status);
    },
  });
  return { box, dev, transport, received, statuses, channels };
};

test('joins as host, completes a device handshake and answers an rpc', async () => {
  const { box, dev, transport, received, statuses } = await setup();
  transport.start();
  const host = await untilHosts(1);
  await untilStatus(statuses, 'connected');
  expect(joins[0]).toBe('{"v":2,"role":"host","token":"tok"}');
  const next = frames(host);
  const channel = await deviceHandshake({
    keys: dev,
    boxPub: box.publicKey,
    send: (data) => {
      host.send(data);
    },
    next,
  });
  const rpc = { kind: 'rpc', id: '1', method: 'sessions.list', params: {} };
  host.send(await channel.seal(bytes.fromUtf8(JSON.stringify(rpc))));
  expect(await plain(channel, await next())).toEqual({
    kind: 'rpc.result',
    id: '1',
    ok: true,
    result: null,
  });
  expect(received).toHaveLength(1);
  const event: Wire = {
    kind: 'ephemeral',
    data: { type: 'agent.status', session: 's', status: 'idle' },
  };
  await transport.broadcast(event);
  expect(await plain(channel, await next())).toEqual(event);
  transport.stop();
  expect(transport.status()).toBe('stopped');
});

// A plaintext relay off loopback is refused before any socket opens (protocol.md § 2).
test('refuses a plaintext relay URL that is not loopback', async () => {
  const { box } = await setup();
  const channels = createDeviceChannels({
    identity: { publicKey: box.publicKey, privateKey: box.privateKey },
    deviceByKey: () => null,
    pairingOpen: () => false,
    onMessage: () => Promise.resolve(null),
  });
  const transport = createHostTransport({
    relayUrl: 'http://box.example:8787',
    roomId,
    token: 'tok',
    channels,
  });
  expect(() => {
    transport.start();
  }).toThrow(expect.objectContaining({ code: 'insecure_transport' }));
  expect(transport.status()).toBe('stopped');
  expect(hosts).toEqual([]);
});

test('reconnects after the relay drops the connection', async () => {
  const { transport, statuses } = await setup();
  transport.start();
  const first = await untilHosts(1);
  await untilStatus(statuses, 'connected');
  first.terminate();
  await untilHosts(2);
  await untilStatus(statuses, 'connected', 2);
  expect(statuses).toEqual(['connecting', 'connected', 'connecting', 'connected']);
  transport.stop();
});

// Resolves once the daemon has answered a ping, and so, in the same step, seen it.
const pinged = (socket: ServerSocket): Promise<void> =>
  new Promise((resolve) => {
    socket.once('pong', () => {
      resolve();
    });
    socket.ping();
  });

// Timers are driven by hand: the transport's, and undici's and ws's own, which only matters if
// a connect were pending during an advance (none is). The sockets stay real (ADR 0041).
test('gives up a relay that stops pinging, and never judges one that has not pinged', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { transport, statuses, channels } = await setup(1000);
  const reset = vi.spyOn(channels, 'reset');
  transport.start();
  const first = await untilHosts(1);
  await untilStatus(statuses, 'connected');
  const firstClosed = new Promise<void>((resolve) => {
    first.once('close', () => {
      resolve();
    });
  });
  vi.advanceTimersByTime(60_000);
  await pinged(first);
  vi.advanceTimersByTime(999);
  await pinged(first);
  vi.advanceTimersByTime(999);
  expect(statuses).toEqual(['connecting', 'connected']);
  expect(reset).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(statuses).toEqual(['connecting', 'connected', 'connecting']);
  expect(reset).toHaveBeenCalledTimes(1);
  await firstClosed;
  vi.advanceTimersByTime(20);
  await untilHosts(2);
  await untilStatus(statuses, 'connected', 2);
  vi.advanceTimersByTime(60_000);
  expect(statuses).toEqual(['connecting', 'connected', 'connecting', 'connected']);
  transport.stop();
  expect(diagnosticsChannel('undici:websocket:ping').hasSubscribers).toBe(false);
});

test("one socket's pings say nothing about another's", async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const pingedOne = await setup(1000);
  const quiet = await setup(1000);
  pingedOne.transport.start();
  const host = await untilHosts(1);
  await untilStatus(pingedOne.statuses, 'connected');
  quiet.transport.start();
  await untilHosts(2);
  await untilStatus(quiet.statuses, 'connected');
  await pinged(host);
  vi.advanceTimersByTime(1000);
  expect(pingedOne.statuses).toEqual(['connecting', 'connected', 'connecting']);
  expect(quiet.statuses).toEqual(['connecting', 'connected']);
  pingedOne.transport.stop();
  quiet.transport.stop();
});
