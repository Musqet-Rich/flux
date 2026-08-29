import type { Ephemeral, FluxEvent } from '@flux/protocol';
import { handshake } from '@flux/protocol';
import { expect, test } from 'vitest';

import { createFakeRelay } from '../../test/fake-relay.ts';
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
  const waiting: { status: ConnectionStatus; resolve: () => void }[] = [];
  let onEphemeral: (() => void) | null = null;
  return {
    events,
    ephemerals,
    statuses,
    onEvent: (e: FluxEvent) => {
      events.push(e);
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

const setup = async () => {
  const relay = await createFakeRelay({
    hello: () => ({ protocol: 1, daemon: 'box', sessions: [summary] }),
    'agent.send': () => ({ seq: 7 }),
  });
  const signals = createSignals();
  const connection = await createConnection({
    relayUrl: 'https://relay.example',
    keys: await handshake.generateKeyPair(),
    boxPub: relay.boxPub,
    socket: relay.socket,
    onEvent: signals.onEvent,
    onEphemeral: signals.onEphemeral,
    onStatus: signals.onStatus,
    minBackoffMs: 1,
    maxBackoffMs: 5,
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
