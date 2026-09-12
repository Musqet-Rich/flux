import { afterAll, expect, test, vi } from 'vitest';

import { defaultBranch } from './default-branch.ts';

// A zone west of UTC, so a local late evening is already the next UTC day and the old
// `toISOString().slice(0, 10)` default would name the wrong date. CI runs in UTC and the dev
// box in London, where these fixtures never cross midnight.
vi.stubEnv('TZ', 'America/New_York');
afterAll(() => {
  vi.unstubAllEnvs();
});

const fixed =
  (...values: number[]) =>
  (length: number): Uint8Array =>
    Uint8Array.from(values.slice(0, length));

test('names the branch after the local date, not the UTC one', () => {
  const now = new Date(2026, 8, 12, 23, 30);
  expect(now.toISOString()).toBe('2026-09-13T03:30:00.000Z');
  expect(defaultBranch(now, fixed(0, 1, 2, 3))).toBe('flux/2026-09-12-abcd');
  expect(defaultBranch(new Date(2026, 0, 3, 0, 5), fixed(0, 0, 0, 0))).toBe('flux/2026-01-03-aaaa');
});

test('maps each byte onto the 36-character alphabet, wrapping past it', () => {
  const now = new Date(2026, 8, 12);
  expect(defaultBranch(now, fixed(0, 25, 26, 35))).toBe('flux/2026-09-12-az09');
  expect(defaultBranch(now, fixed(36, 37, 255, 61))).toBe('flux/2026-09-12-abdz');
});

test('by default draws four lowercase alphanumerics from the platform, fresh each call', () => {
  const names = new Set(Array.from({ length: 50 }, () => defaultBranch()));
  for (const name of names) expect(name).toMatch(/^flux\/\d{4}-\d{2}-\d{2}-[a-z0-9]{4}$/u);
  expect(names.size).toBeGreaterThan(1);
});
