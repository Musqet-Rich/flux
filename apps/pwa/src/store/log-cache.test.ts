import type { FluxEvent } from '@flux/protocol';
import { expect, test } from 'vitest';

import { createMemoryStorage } from '../client/create-memory-storage.ts';
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

const internals = (): StoreInternals => ({
  options: { storage: createMemoryStorage(), socket: () => ({ send() {}, close() {}, on() {} }) },
  state: storeState(),
  logs: new Map(),
  connection: null,
  sync: null,
  vapidPublicKey: null,
  refreshing: null,
  deviceId: null,
});

test('appends to the view and writes only the chunks the new tail touches', async () => {
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
  expect(await storage.get(logCache.key('s1', 0))).toHaveLength(size);
  expect(await storage.get(logCache.key('s1', 1))).toHaveLength(1);
  const before = view?.events;
  await storage.remove(logCache.key('s1', 0));
  log.receive(ev(size + 2));
  logCache.publish(i, log);
  expect(i.state.logs['s1']?.events).toBe(before);
  expect(view?.events.length).toBe(size + 2);
  expect(await storage.get(logCache.key('s1', 0))).toBeUndefined();
  expect(await storage.get(logCache.key('s1', 1))).toHaveLength(2);
  expect(await logCache.load(i, 's1')).toEqual([]);
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
