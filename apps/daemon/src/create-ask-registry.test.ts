import { expect, test, vi } from 'vitest';

import { createAskRegistry } from './create-ask-registry.ts';

test('an answer from a device resolves the ask', async () => {
  const asks = createAskRegistry();
  const waiting = asks.ask('a1', 60_000);
  expect(asks.pending()).toEqual(['a1']);
  expect(asks.answer('a1', 'yes')).toBe(true);
  expect(await waiting).toEqual({ answer: 'yes', by: 'device' });
  expect(asks.pending()).toEqual([]);
  expect(asks.answer('a1', 'again')).toBe(false);
});

test('a timeout resolves the ask with an empty answer', async () => {
  vi.useFakeTimers();
  const asks = createAskRegistry();
  const waiting = asks.ask('a2', 1000);
  vi.advanceTimersByTime(1000);
  expect(await waiting).toEqual({ answer: '', by: 'timeout' });
  vi.useRealTimers();
});

test('close settles everything still pending', async () => {
  const asks = createAskRegistry();
  const a = asks.ask('x', 60_000);
  const b = asks.ask('y', 60_000);
  asks.close();
  expect(await Promise.all([a, b])).toEqual([
    { answer: '', by: 'timeout' },
    { answer: '', by: 'timeout' },
  ]);
});

test('an aborted signal settles the ask as aborted, and a late answer is refused', async () => {
  const asks = createAskRegistry();
  const controller = new AbortController();
  const waiting = asks.ask('a3', 60_000, controller.signal);
  controller.abort();
  expect(await waiting).toEqual({ answer: '', by: 'aborted' });
  expect(asks.pending()).toEqual([]);
  expect(asks.answer('a3', 'late')).toBe(false);
});
