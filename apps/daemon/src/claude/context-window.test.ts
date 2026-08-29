import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { contextWindow } from './context-window.ts';

// The operator's own FLUX_CONTEXT_WINDOW must not leak into the table cases.
beforeEach(() => {
  vi.stubEnv('FLUX_CONTEXT_WINDOW', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// The numbers are the ones on each model's page under platform.claude.com/docs/en/models
// (2026-08-29); a wrong prefix here is a wrong percentage on every phone.
test.each([
  ['claude-fable-5', 1_000_000],
  ['claude-opus-5', 1_000_000],
  ['claude-sonnet-5', 1_000_000],
  ['claude-opus-4-8', 1_000_000],
  ['claude-opus-4-7', 1_000_000],
  ['claude-opus-4-6', 1_000_000],
  ['claude-sonnet-4-6', 1_000_000],
  ['claude-opus-4-5', 200_000],
  ['claude-opus-4-5-20251101', 200_000],
  ['claude-sonnet-4-5', 200_000],
  ['claude-sonnet-4-5-20250929', 200_000],
  ['claude-haiku-4-5', 200_000],
  ['claude-haiku-4-5-20251001', 200_000],
])('contextWindow(%s) is %d from the table', (model, expected) => {
  expect(contextWindow(model)).toBe(expected);
});

test.each([
  'gpt-4o',
  'claude-haiku-3-5',
  'claude-opus-3',
  'claude-opus-4-1',
  'claude-opus-4-20250514',
  'claude-sonnet-4-20250514',
  'mystery',
  '',
])('contextWindow(%s) is undefined for a model not in the table', (model) => {
  expect(contextWindow(model)).toBeUndefined();
});

test.each([
  ['claude-opus-5', '500000', 500_000],
  ['gpt-4o', '250000', 250_000],
  ['claude-haiku-4-5', '2000000', 2_000_000],
])('FLUX_CONTEXT_WINDOW=%s wins for %s', (model, override, expected) => {
  expect(contextWindow(model, override)).toBe(expected);
});

test.each([
  ['claude-opus-5', '', 1_000_000],
  ['claude-opus-5', 'lots', 1_000_000],
  ['claude-opus-5', '0', 1_000_000],
  ['claude-opus-5', '-5', 1_000_000],
  ['claude-opus-5', '1.5', 1_000_000],
])(
  'an invalid override %s is ignored and the table is used for %s',
  (model, override, expected) => {
    expect(contextWindow(model, override)).toBe(expected);
  },
);

test('an invalid override on an unknown model is still undefined', () => {
  expect(contextWindow('gpt-4o', 'nope')).toBeUndefined();
});

test('the override defaults to FLUX_CONTEXT_WINDOW from the environment', () => {
  vi.stubEnv('FLUX_CONTEXT_WINDOW', '123456');
  expect(contextWindow('gpt-4o')).toBe(123_456);
  expect(contextWindow('claude-opus-5')).toBe(123_456);
});
