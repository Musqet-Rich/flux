import { expect, test } from 'vitest';

import type { OpencodePending } from './map-opencode-line.ts';
import type { OpencodeLine } from './parse-opencode-line.ts';
import { mapOpencodeLine } from './map-opencode-line.ts';

// The branches the two captured fixtures do not carry (reasoning, error, other, empty text, a
// non-writer tool); the fixture-driven paths are asserted in opencode-adapter.test.ts.

const freshPending = (): OpencodePending => ({
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
  steps: 0,
});

const map = (line: OpencodeLine) => mapOpencodeLine(line, freshPending(), '/w');

test('reasoning maps to the thinking indicator', () => {
  expect(map({ kind: 'reasoning' })).toEqual({ events: [], thinking: { active: true } });
});

test('an error part is logged raw on the opencode channel', () => {
  expect(map({ kind: 'error', message: 'no credit' })).toEqual({
    events: [{ type: 'raw', payload: { agent: 'opencode', data: { error: 'no credit' } } }],
  });
});

test('an ignored line emits nothing and an unknown line is logged raw', () => {
  expect(map({ kind: 'ignored' })).toEqual({ events: [] });
  expect(map({ kind: 'other', data: { x: 1 } })).toEqual({
    events: [{ type: 'raw', payload: { agent: 'opencode', data: { x: 1 } } }],
  });
});

test('an empty text part emits nothing', () => {
  expect(map({ kind: 'text', text: '' })).toEqual({ events: [] });
});

test('a read tool does not mark the worktree changed', () => {
  const mapped = map({
    kind: 'tool',
    call: { tool: 'read', callId: 'c', ok: true, input: { filePath: '/w/a.ts' }, output: 'x' },
  });
  expect(mapped.filesChanged).toBe(false);
  expect(mapped.events[0]).toMatchObject({ payload: { summary: 'read a.ts' } });
});

test('usage sums across steps and the turn ends only on the stop step', () => {
  const pending = freshPending();
  const first = mapOpencodeLine(
    {
      kind: 'step_finish',
      reason: 'tool-calls',
      tokens: { input: 1, output: 2, cacheWrite: 3, cacheRead: 4 },
      cost: 0.1,
    },
    pending,
    '/w',
  );
  expect(first).toEqual({ events: [] });
  const second = mapOpencodeLine(
    {
      kind: 'step_finish',
      reason: 'stop',
      tokens: { input: 5, output: 6, cacheWrite: 7, cacheRead: 8 },
      cost: 0.2,
    },
    pending,
    '/w',
  );
  expect(second.turnEnded).toBe(true);
  const payload = (
    second.events[0] as { payload: { usage: unknown; costUsd: number; numTurns: number } }
  ).payload;
  expect(payload.usage).toEqual({ input: 6, output: 8, cacheRead: 12, cacheWrite: 10 });
  expect(payload.numTurns).toBe(2);
  expect(payload.costUsd).toBeCloseTo(0.3, 10);
});
