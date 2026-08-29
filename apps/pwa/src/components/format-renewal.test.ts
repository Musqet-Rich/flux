import { expect, test } from 'vitest';

import { formatRenewal } from './format-renewal.ts';

// The clock is injected, so every case is against a fixed `now` of the epoch and an ISO time a
// known distance away.
const at = (minutes: number): string => new Date(minutes * 60_000).toISOString();

test.each([
  [at(40), '40m'],
  [at(59), '59m'],
  [at(60), '1h'],
  [at(130), '2h10m'],
  [at(11 * 60), '11h'],
  [at(23 * 60 + 59), '23h59m'],
  [at(24 * 60), '1d'],
  [at(25 * 60), '1d'],
  [at(2 * 24 * 60), '2d'],
  [at(0), '0m'],
])('formatRenewal(%s) at the epoch is %s', (resetsAt, expected) => {
  expect(formatRenewal(resetsAt, 0)).toBe(expected);
});

test('a time in the past collapses to 0m', () => {
  expect(formatRenewal(at(5), 10 * 60_000)).toBe('0m');
});

test('a partial minute in the future is still 0m, not a fraction', () => {
  expect(formatRenewal(new Date(30_000).toISOString(), 0)).toBe('0m');
});

test('an unparseable time is the empty string, not NaN', () => {
  expect(formatRenewal('not a date', 0)).toBe('');
});
