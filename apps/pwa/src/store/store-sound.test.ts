import type { FluxEvent, SessionSummary, Settings } from '@flux/protocol';
import { pairing } from '@flux/protocol';
import { expect, test } from 'vitest';
import { reactive } from 'vue';

import type { FakeRelay, Handlers } from '../../test/fake-relay.ts';
import { createFakeRelay } from '../../test/fake-relay.ts';
import { settingsFixture } from '../../test/settings-fixture.ts';
import { until } from '../../test/until.ts';
import { ClientError } from '../client/client-error.ts';
import type { Storage } from '../client/create-memory-storage.ts';
import { createMemoryStorage } from '../client/create-memory-storage.ts';
import type { Store } from './create-store.ts';
import { createStore } from './create-store.ts';
import { notificationSound } from './notification-sound.ts';

// The notification sound's side of the store: which live events ring, under which box settings,
// and how the device's choice is kept. The player and the hush timer are injected, so a test
// reads what was played (a reactive list, so `until` can wait on it) and fires the timer itself.

const summary = (session: string, state: 'running' | 'idle'): SessionSummary => ({
  session,
  title: session,
  repo: '/r',
  branch: 'b',
  harness: 'claude',
  state,
  lastSeq: 1,
  createdAt: 't',
  updatedAt: 't',
});

// A box holding `r`, running, and `i`, idle. Every `settings.get` lands on `fetches`, a
// reactive list so `until` can wait for one; `refuse.now` makes the box answer with an error.
const box = async (settings: Settings) => {
  const fetches = reactive<string[]>([]);
  const refuse = { now: false };
  const handlers: Handlers = {
    hello: () => ({
      protocol: 1,
      daemon: 'box',
      sessions: [summary('r', 'running'), summary('i', 'idle')],
    }),
    'pair.request': () => ({ deviceId: 'dev-1' }),
    'settings.get': () => {
      fetches.push(refuse.now ? 'refused' : 'sent');
      if (refuse.now) throw new ClientError('internal', 'refused');
      return settings;
    },
  };
  return { relay: await createFakeRelay(handlers), fetches, refuse };
};

// Emits an event for `session` and waits until the store has taken it in, since the fake relay
// delivers after `emit` resolves.
const emitter = (store: Store, relay: FakeRelay) => {
  const seqs = new Map<string, number>();
  return async (session: string, type: string, payload: unknown): Promise<void> => {
    const seq = (seqs.get(session) ?? 1) + 1;
    seqs.set(session, seq);
    const event: FluxEvent = { seq, ts: '2026-01-01T00:00:00Z', session, type, payload };
    await relay.emit(event);
    await until(() => store.state.sessions.find((s) => s.session === session)?.lastSeq === seq);
  };
};

const setup = async (storage: Storage = createMemoryStorage(), settings = settingsFixture()) => {
  const { relay, fetches, refuse } = await box(settings);
  const played = reactive<string[]>([]);
  const timers: (() => void)[] = [];
  const store = createStore({
    storage,
    socket: relay.socket,
    playSound: (name) => {
      played.push(name);
    },
    schedule: (fn) => {
      timers.push(fn);
      return () => {
        timers.splice(timers.indexOf(fn), 1);
      };
    },
    minBackoffMs: 1,
    maxBackoffMs: 5,
  });
  const secret = new Uint8Array(pairing.secretLength);
  const url = pairing.url('https://relay.example', { boxPub: relay.boxPub, secret });
  await store.pair('https://relay.example', new URL(url).hash);
  // Fires the pending hush timer, so the next trigger rings again.
  const quiet = (): void => {
    timers.splice(0).forEach((fn) => {
      fn();
    });
  };
  return { store, relay, played, timers, emit: emitter(store, relay), quiet, fetches, refuse };
};

test('picking a sound plays it at once and keeps it for the next boot', async () => {
  const storage = createMemoryStorage();
  const first = await setup(storage);
  expect(first.store.state.sound).toBe('none');
  expect(await first.store.setSound('chime')).toBe(true);
  expect(first.store.state.sound).toBe('chime');
  expect(first.played).toEqual(['chime']);
  expect(await storage.get(notificationSound.storageKey)).toBe('chime');
  first.store.stop();
  // A second store on the same storage (the next page load) comes up with the choice made and
  // fetches the box's triggers on every connect, so it knows what to ring for; a box that
  // refuses leaves the last fetched settings in place.
  const second = await setup(storage);
  await until(() => second.store.state.settings !== null);
  expect(second.store.state.sound).toBe('chime');
  expect(second.fetches).toEqual(['sent']);
  expect(second.played).toEqual([]);
  second.refuse.now = true;
  second.relay.hostLeave();
  await until(() => second.store.state.status !== 'connected');
  second.relay.hostJoin();
  await until(() => second.fetches.length === 2);
  await until(() => second.store.state.status === 'connected');
  expect(second.fetches).toEqual(['sent', 'refused']);
  expect(second.store.state.settings).not.toBeNull();
  expect(second.store.state.error).toBeNull();
  second.store.stop();
  // A stored value from another build is ignored rather than trusted.
  await storage.set(notificationSound.storageKey, 'gong');
  const third = await setup(storage);
  expect(third.store.state.sound).toBe('none');
  expect(third.fetches).toEqual([]);
  third.store.stop();
});

test('the events the box would push ring; the rest do not', async () => {
  const { store, played, emit, quiet } = await setup();
  await store.setSound('ping');
  played.length = 0;
  await emit('i', 'ask', { askId: 'a1', question: 'Which?', timeoutAt: 't' });
  expect(played).toEqual(['ping']);
  quiet();
  await emit('i', 'notify', { level: 'info', summary: 'progress' });
  await emit('i', 'msg.assistant', { text: 'hi' });
  await emit('i', 'session.state', { state: 'idle' });
  expect(played).toEqual(['ping']);
  await emit('i', 'notify', { level: 'blocked', summary: 'stuck' });
  expect(played).toEqual(['ping', 'ping']);
  quiet();
  // Idle only rings after running: the list held `r` as running and `i` as idle.
  await emit('r', 'session.state', { state: 'idle' });
  expect(played).toEqual(['ping', 'ping', 'ping']);
  quiet();
  await emit('r', 'session.state', { state: 'idle' });
  await emit('r', 'session.state', { state: 'running' });
  await emit('r', 'session.state', { state: 'ended' });
  expect(played).toEqual(['ping', 'ping', 'ping']);
  await emit('r', 'notify', { level: 'done', summary: 'finished' });
  expect(played).toEqual(['ping', 'ping', 'ping', 'ping']);
  store.stop();
});

test('triggers arriving together ring once; the box settings silence the ones turned off', async () => {
  const settings: Settings = settingsFixture();
  settings.flux.notifyOnDone = true;
  settings.flux.notifyOnIdle = false;
  settings.flux.notifyOnAsk = false;
  const { store, played, timers, emit, quiet } = await setup(undefined, settings);
  // The Settings screen, where the picker lives, has fetched the box's settings on open.
  await store.refreshSettings();
  await store.setSound('pulse');
  played.length = 0;
  await emit('r', 'notify', { level: 'done', summary: 'finished' });
  await emit('r', 'session.state', { state: 'idle' });
  await emit('r', 'notify', { level: 'done', summary: 'again' });
  expect(played).toEqual(['pulse']);
  expect(timers).toHaveLength(1);
  quiet();
  await emit('r', 'notify', { level: 'done', summary: 'later' });
  expect(played).toEqual(['pulse', 'pulse']);
  quiet();
  await emit('i', 'ask', { askId: 'a2', question: 'Which?', timeoutAt: 't' });
  await emit('i', 'session.state', { state: 'running' });
  await emit('i', 'session.state', { state: 'idle' });
  expect(played).toEqual(['pulse', 'pulse']);
  // Choosing None stops it all, and stopping the store drops the pending timer.
  await store.setSound('none');
  store.playSound();
  await emit('r', 'notify', { level: 'done', summary: 'silent' });
  expect(played).toEqual(['pulse', 'pulse']);
  await store.setSound('pulse');
  store.playSound();
  expect(played).toEqual(['pulse', 'pulse', 'pulse', 'pulse']);
  await emit('r', 'notify', { level: 'done', summary: 'ringing' });
  expect(timers).toHaveLength(1);
  store.stop();
  expect(timers).toHaveLength(0);
});
