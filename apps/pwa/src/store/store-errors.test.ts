import { expect, test } from 'vitest';

import { createMemoryStorage } from '../client/create-memory-storage.ts';
import { socket } from '../client/socket.ts';
import { storeErrors } from './store-errors.ts';
import type { StoreInternals } from './store-state.ts';
import { storeState } from './store-state.ts';

// Only the error slice of the store is under test, so the internals carry a fake clock and
// no connection.
const internals = () => {
  const timers: { fn: () => void; ms: number }[] = [];
  const i: StoreInternals = {
    options: {
      storage: createMemoryStorage(),
      socket,
      schedule: (fn, ms) => {
        const timer = { fn, ms };
        timers.push(timer);
        return () => {
          timers.splice(timers.indexOf(timer), 1);
        };
      },
    },
    state: storeState(),
    logs: new Map(),
    connection: null,
    sync: null,
    vapidPublicKey: null,
    refreshing: null,
    deviceId: null,
    errorTimer: null,
  };
  return { i, timers };
};

test('an action error goes on its own after a while; a fresh one restarts the clock', () => {
  const { i, timers } = internals();
  storeErrors.report(i, new Error('first'));
  expect(i.state.error).toEqual({ message: 'first', kind: 'action' });
  expect(timers.map((t) => t.ms)).toEqual([storeErrors.actionErrorMs]);
  storeErrors.report(i, 'second');
  expect(i.state.error).toEqual({ message: 'second', kind: 'action' });
  expect(timers.length).toBe(1);
  timers[0]?.fn();
  expect(i.state.error).toBeNull();
  expect(i.errorTimer).toBeNull();
});

test('a connection error has no clock and survives a success; clear takes anything', () => {
  const { i, timers } = internals();
  storeErrors.report(i, new Error('gone'), 'connection');
  expect(i.state.error).toEqual({ message: 'gone', kind: 'connection' });
  expect(timers).toEqual([]);
  storeErrors.clearAction(i);
  expect(i.state.error?.kind).toBe('connection');
  storeErrors.clear(i);
  expect(i.state.error).toBeNull();
  storeErrors.report(i, new Error('failed'));
  storeErrors.clearAction(i);
  expect(i.state.error).toBeNull();
  expect(timers).toEqual([]);
});
