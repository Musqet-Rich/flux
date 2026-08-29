import type { Ephemeral, FluxEvent, KeyPair } from '@flux/protocol';
import { handshake } from '@flux/protocol';
import { expect, test } from 'vitest';

import type { FakeRelay } from '../../test/fake-relay.ts';
import { createFakeRelay } from '../../test/fake-relay.ts';
import type { ClientError } from './client-error.ts';
import type { ConnectionStatus } from './create-connection.ts';
import { createConnection } from './create-connection.ts';

const summary = {
  session: 's1',
  title: 'T',
  repo: '/r',
  branch: 'main',
  agent: 'claude' as const,
  state: 'idle' as const,
  lastSeq: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

// Everything the connection reports, plus promises that resolve on the next occurrence.
const createSignals = () => {
  const events: FluxEvent[] = [];
  const ephemerals: Ephemeral[] = [];
  const statuses: ConnectionStatus[] = [];
  const errors: ClientError[] = [];
  const waiting: { status: ConnectionStatus; resolve: () => void }[] = [];
  let onEphemeral: (() => void) | null = null;
  return {
    events,
    ephemerals,
    statuses,
    errors,
    onEvent: (e: FluxEvent) => {
      events.push(e);
    },
    onError: (e: ClientError) => {
      errors.push(e);
    },
    onEphemeral: (d: Ephemeral) => {
      ephemerals.push(d);
      onEphemeral?.();
    },
    onStatus: (s: ConnectionStatus) => {
      statuses.push(s);
      for (const w of waiting.splice(0)) {
        if (w.status === s) w.resolve();
        else waiting.push(w);
      }
    },
    nextEphemeral: (): Promise<void> =>
      new Promise((resolve) => {
        onEphemeral = resolve;
      }),
    status: (status: ConnectionStatus): Promise<void> =>
      new Promise((resolve) => {
        waiting.push({ status, resolve });
      }),
  };
};

const createRelay = () =>
  createFakeRelay({
    hello: () => ({ protocol: 1, daemon: 'box', sessions: [summary] }),
    'agent.send': () => ({ seq: 7 }),
  });

// A connection to `relay` as the device holding `keys`; a second one with the same keys is
// another tab of the same browser profile.
const setup = async (relay?: FakeRelay, keys?: KeyPair, relayUrl = 'https://relay.example') => {
  relay ??= await createRelay();
  const signals = createSignals();
  const connection = await createConnection({
    relayUrl,
    keys: keys ?? (await handshake.generateKeyPair()),
    boxPub: relay.boxPub,
    socket: relay.socket,
    onEvent: signals.onEvent,
    onEphemeral: signals.onEphemeral,
    onStatus: signals.onStatus,
    onError: signals.onError,
    minBackoffMs: 1,
    maxBackoffMs: 5,
    keepaliveMs: 2,
  });
  return { relay, signals, connection };
};

test('joins, handshakes, calls, and receives events and ephemerals', async () => {
  const { relay, signals, connection } = await setup();
  await expect(connection.call('hello', { protocol: 1 })).rejects.toMatchObject({
    code: 'offline',
  });
  connection.start();
  await connection.connected();
  expect(await connection.call('hello', { protocol: 1 })).toEqual({
    protocol: 1,
    daemon: 'box',
    sessions: [summary],
  });
  await expect(connection.call('sessions.list', {})).rejects.toMatchObject({ code: 'not_found' });
  const event: FluxEvent = {
    seq: 1,
    ts: '2026-01-01T00:00:00Z',
    session: 's1',
    type: 'msg.user',
    payload: { text: 'hi' },
  };
  const arrived = signals.nextEphemeral();
  await relay.emit(event);
  await relay.ephemeral({ type: 'delta', session: 's1', forSeq: 2, text: 'he' });
  await arrived;
  expect(signals.events).toEqual([event]);
  expect(signals.ephemerals).toEqual([{ type: 'delta', session: 's1', forSeq: 2, text: 'he' }]);
  expect(signals.statuses).toEqual(['connecting', 'connected']);
  connection.stop();
  expect(connection.status()).toBe('stopped');
  await expect(connection.connected()).rejects.toMatchObject({ code: 'offline' });
});

test('waits for the host when the room is empty, then handshakes', async () => {
  const { relay, signals, connection } = await setup();
  relay.hostLeave();
  const noHost = signals.status('no_host');
  connection.start();
  await noHost;
  relay.hostJoin();
  await connection.connected();
  expect(signals.statuses).toEqual(['connecting', 'no_host', 'connected']);
  const left = signals.status('no_host');
  relay.hostLeave();
  await left;
  expect(connection.status()).toBe('no_host');
  connection.stop();
});

test('reconnects after the socket drops and fails the calls in flight', async () => {
  const { relay, connection } = await setup();
  connection.start();
  await connection.connected();
  const inFlight = connection.call('hello', { protocol: 1 });
  relay.dropGuests();
  await expect(inFlight).rejects.toMatchObject({ code: 'offline' });
  expect(connection.status()).toBe('connecting');
  await connection.connected();
  expect(await connection.call('agent.send', { session: 's1', text: 'go' })).toEqual({ seq: 7 });
  expect(relay.guests()).toBe(1);
  connection.stop();
  expect(relay.guests()).toBe(0);
});

// A box on another protocol version answers the handshake with its version and no keys
// (protocol.md § 8). The device says which side to update, keeps retrying in case the box is
// updated meanwhile, and never reports a channel that cannot decrypt as connected.
test('a box on another protocol version is reported, and retried once updated', async () => {
  const { relay, signals, connection } = await setup();
  relay.boxVersion(1);
  connection.start();
  await expect.poll(() => signals.errors.length).toBeGreaterThanOrEqual(1);
  expect(signals.errors[0]).toMatchObject({
    code: 'bad_version',
    message: 'Box is on protocol 1; update it',
  });
  expect(signals.statuses).not.toContain('connected');
  relay.boxVersion(3);
  await expect
    .poll(() => signals.errors.at(-1)?.message)
    .toBe('Box is on protocol 3; update this app');
  relay.boxVersion(2);
  await connection.connected();
  connection.stop();
});

// A plaintext relay is only ever the developer's own machine (protocol.md § 2).
test('refuses a plaintext relay off loopback before opening a socket', async () => {
  const relay = await createRelay();
  await expect(setup(relay, undefined, 'http://relay.example')).rejects.toMatchObject({
    code: 'insecure_transport',
  });
  expect(relay.guests()).toBe(0);
  const { connection } = await setup(relay, undefined, 'http://localhost:5173');
  connection.start();
  await connection.connected();
  connection.stop();
});

test('a refused join backs off and retries', async () => {
  const { relay, signals, connection } = await setup();
  relay.refuseJoins('room_full');
  const connecting = signals.status('connecting');
  connection.start();
  await connecting;
  expect(connection.status()).toBe('connecting');
  relay.refuseJoins(null);
  await connection.connected();
  expect(signals.statuses.at(-1)).toBe('connected');
  connection.stop();
});

const event = (seq: number): FluxEvent => ({
  seq,
  ts: '2026-01-01T00:00:00Z',
  session: 's1',
  type: 'msg.user',
  payload: { text: `e${seq}` },
});

// Two tabs of one browser profile hold the same device key, so the box's frames for either
// carry the same fingerprint; the relay broadcasts all of them, so each tab sees the other's
// box hello and every frame sealed for the other. Neither may drop its socket over that:
// both stay up through the other's handshake, both get every event, each gets its own
// rpc results, and one stopping does not touch the other.
test('two tabs of one device coexist, each on its own channel', async () => {
  const relay = await createRelay();
  const keys = await handshake.generateKeyPair();
  const a = await setup(relay, keys);
  const b = await setup(relay, keys);
  a.connection.start();
  await a.connection.connected();
  b.connection.start();
  await b.connection.connected();
  const arrived = Promise.all([a.signals.nextEphemeral(), b.signals.nextEphemeral()]);
  await relay.emit(event(1));
  await relay.ephemeral({ type: 'delta', session: 's1', forSeq: 2, text: 'x' });
  await arrived;
  expect(a.signals.events).toEqual([event(1)]);
  expect(b.signals.events).toEqual([event(1)]);
  expect(await a.connection.call('agent.send', { session: 's1', text: 'from a' })).toEqual({
    seq: 7,
  });
  expect(await b.connection.call('hello', { protocol: 1 })).toMatchObject({ daemon: 'box' });
  expect(a.signals.statuses).toEqual(['connecting', 'connected']);
  expect(b.signals.statuses).toEqual(['connecting', 'connected']);
  expect(relay.guests()).toBe(2);
  a.connection.stop();
  const alone = b.signals.nextEphemeral();
  await relay.ephemeral({ type: 'delta', session: 's1', forSeq: 2, text: 'y' });
  await alone;
  expect(b.signals.ephemerals).toHaveLength(2);
  expect(b.connection.status()).toBe('connected');
  expect(relay.guests()).toBe(1);
  b.connection.stop();
});

test('a connected tab keeps saying hello so the box knows it is alive', async () => {
  const { relay, connection } = await setup();
  connection.start();
  await connection.connected();
  const hellos = (): number => relay.calls.filter((c) => c.method === 'hello').length;
  await expect.poll(hellos).toBeGreaterThanOrEqual(3);
  connection.stop();
});
