import type { FluxEvent } from '@flux/protocol';
import { beforeEach, expect, test } from 'vitest';
import { isReactive, toRaw } from 'vue';

import { storeOptions } from '../../test/store-options.ts';
import { createSessionLog } from '../client/create-session-log.ts';
import { logCache } from './log-cache.ts';
import type { StoreInternals } from './store-state.ts';
import { storeState } from './store-state.ts';

const ev = (seq: number): FluxEvent => ({
  seq,
  ts: '2026-01-01T00:00:00Z',
  session: 's1',
  type: 'msg.user',
  payload: { text: `m${seq}` },
});

// The cache's write delay, fired by the test instead of the clock.
const timers: (() => void)[] = [];
const fire = (): void => {
  for (const fn of timers.splice(0)) fn();
};
const schedule = (fn: () => void): (() => void) => {
  timers.push(fn);
  return () => {
    timers.splice(timers.indexOf(fn), 1);
  };
};

beforeEach(() => {
  timers.splice(0);
});

const internals = (): StoreInternals => ({
  options: storeOptions({ socket: () => ({ send() {}, close() {}, on() {} }), schedule }),
  state: storeState(),
  logs: new Map(),
  connection: null,
  sync: null,
  vapidPublicKey: null,
  refreshing: null,
  deviceId: null,
  errorTimer: null,
  connectionError: null,
  soundHush: null,
  cacheWrites: new Map(),
  files: new Map(),
  thumbLoads: new Map(),
  thumbOwners: new Map(),
});

test('appends to the view and writes only the chunks the new tail touches, after a delay', async () => {
  const i = internals();
  const { storage } = i.options;
  const size = logCache.chunkSize;
  const log = createSessionLog(
    's1',
    Array.from({ length: size + 1 }, (_, n) => ev(n + 1)),
  );
  logCache.publish(i, log);
  const view = i.state.logs['s1'];
  expect(view?.events.length).toBe(size + 1);
  // The first view is the cache's own events: nothing to write back.
  expect(timers).toHaveLength(0);
  log.receive(ev(size + 2));
  logCache.publish(i, log);
  log.receive(ev(size + 3));
  logCache.publish(i, log);
  expect(i.state.logs['s1']?.events).toBe(view?.events);
  expect(view?.events.length).toBe(size + 3);
  // The second publish joins the first's write, keeping its time.
  expect(timers).toHaveLength(1);
  fire();
  expect(await storage.get(logCache.key('s1', 0))).toBeUndefined();
  expect(await storage.get(logCache.key('s1', 1))).toHaveLength(3);
  expect(await logCache.load(i, 's1')).toEqual([]);
});

test('the view holds the events themselves, not proxies over them', () => {
  const i = internals();
  const first = ev(1);
  const log = createSessionLog('s1', [first]);
  logCache.publish(i, log);
  expect(toRaw(i.state.logs['s1']?.events[0])).toBe(first);
  expect(isReactive(i.state.logs['s1']?.events[0])).toBe(false);
});

test('stopping writes what is waiting at once', async () => {
  const i = internals();
  const log = createSessionLog('s1', []);
  i.logs.set('s1', log);
  logCache.publish(i, log);
  log.receive(ev(1));
  logCache.publish(i, log);
  logCache.flushWrites(i);
  expect(timers).toHaveLength(0);
  expect(i.cacheWrites.size).toBe(0);
  expect(await i.options.storage.get(logCache.key('s1', 0))).toHaveLength(1);
});

test('forgetting the box drops the writes still waiting', async () => {
  const i = internals();
  const log = createSessionLog('s1', []);
  logCache.publish(i, log);
  log.receive(ev(1));
  logCache.publish(i, log);
  expect(timers).toHaveLength(1);
  logCache.cancelWrites(i);
  expect(timers).toHaveLength(0);
  expect(await i.options.storage.get(logCache.key('s1', 0))).toBeUndefined();
});

test('loads chunks in order, stopping at the first missing or corrupt one', async () => {
  const i = internals();
  const { storage } = i.options;
  const size = logCache.chunkSize;
  const full = Array.from({ length: size }, (_, n) => ev(n + 1));
  await storage.set(logCache.key('s1', 0), full);
  await storage.set(logCache.key('s1', 1), [ev(size + 1)]);
  expect((await logCache.load(i, 's1')).map((e) => e.seq).at(-1)).toBe(size + 1);
  await storage.set(logCache.key('s1', 1), [{ seq: 'bad' }]);
  expect(await logCache.load(i, 's1')).toHaveLength(size);
});
