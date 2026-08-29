import { expect, test } from 'vitest';

import { createRateLimiter } from './create-rate-limiter.ts';

const clock = (start = 0): { now: () => number; tick: (ms: number) => void } => {
  let t = start;
  return {
    now: () => t,
    tick: (ms) => {
      t += ms;
    },
  };
};

test('allows up to the limit within a window, then refuses', () => {
  const c = clock();
  const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: c.now });
  expect([limiter.allow('a'), limiter.allow('a'), limiter.allow('a')]).toEqual([true, true, true]);
  expect(limiter.allow('a')).toBe(false);
});

test('keys are independent', () => {
  const c = clock();
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now });
  expect(limiter.allow('a')).toBe(true);
  expect(limiter.allow('b')).toBe(true);
  expect(limiter.allow('a')).toBe(false);
});

test('a new window resets the count and expired keys are pruned', () => {
  const c = clock(5000);
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: c.now });
  expect(limiter.allow('a')).toBe(true);
  expect(limiter.allow('a')).toBe(false);
  c.tick(999);
  expect(limiter.allow('a')).toBe(false);
  c.tick(1);
  expect(limiter.allow('a')).toBe(true);
  expect(limiter.size()).toBe(1);
  c.tick(1000);
  expect(limiter.allow('b')).toBe(true);
  expect(limiter.size()).toBe(1);
});

test('defaults to the wall clock', () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
  expect(limiter.allow('a')).toBe(true);
  expect(limiter.allow('a')).toBe(true);
  expect(limiter.allow('a')).toBe(false);
});
