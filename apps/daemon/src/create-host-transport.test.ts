import type { Bytes, Channel, Wire } from '@flux/protocol';
import { bytes, handshake } from '@flux/protocol';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, test } from 'vitest';
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

const setup = async () => {
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
    onStatus: (status) => {
      statuses.push(status);
    },
  });
  return { box, dev, transport, received, statuses };
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
