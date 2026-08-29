import { expect, test } from 'vitest';

import { claudeAdapter } from './claude-adapter.ts';

// Lines as Claude Code 2.1.251 prints them (fixtures/claude/session-thinking-tasks-pr).
const start = JSON.stringify({
  type: 'stream_event',
  event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
});
const stop = JSON.stringify({
  type: 'stream_event',
  event: { type: 'content_block_stop', index: 0 },
});
const tokens = (n: number): string =>
  JSON.stringify({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: n });

const withClock = (): { adapter: ReturnType<typeof claudeAdapter>; clock: { now: number } } => {
  const clock = { now: 1000 };
  return { adapter: claudeAdapter('/w', { now: () => clock.now }), clock };
};

test('thinking start and stop always pass, token counts are throttled by time or step', () => {
  const { adapter, clock } = withClock();
  expect(adapter.mapLine(start)?.thinking).toEqual({ active: true });
  // 10 ms and 50 tokens after the start: neither threshold reached.
  clock.now += 10;
  expect(adapter.mapLine(tokens(50))?.thinking).toBeUndefined();
  // 100 tokens since the last one sent (the start counted as 0).
  expect(adapter.mapLine(tokens(100))?.thinking).toEqual({ active: true, estimatedTokens: 100 });
  expect(adapter.mapLine(tokens(150))?.thinking).toBeUndefined();
  // 500 ms later the same count goes through.
  clock.now += 500;
  expect(adapter.mapLine(tokens(150))?.thinking).toEqual({ active: true, estimatedTokens: 150 });
  expect(adapter.mapLine(stop)?.thinking).toEqual({ active: false });
  // A new block starts from zero again, so 100 tokens is a step even 1 ms later.
  clock.now += 1;
  expect(adapter.mapLine(start)?.thinking).toEqual({ active: true });
  expect(adapter.mapLine(tokens(100))?.thinking).toEqual({ active: true, estimatedTokens: 100 });
});

test('a dropped count still maps the line (to nothing) and other lines are untouched', () => {
  const { adapter } = withClock();
  adapter.mapLine(start);
  const dropped = adapter.mapLine(tokens(10));
  expect(dropped).toEqual({ events: [] });
  const other = adapter.mapLine(JSON.stringify({ type: 'system', subtype: 'hook_started' }));
  expect(other?.events[0]?.type).toBe('raw');
  expect(adapter.mapLine('not json')).toBeNull();
});

test('reset forgets the open thinking block so a later stop of that index is raw', () => {
  const { adapter } = withClock();
  adapter.mapLine(start);
  adapter.reset();
  const after = adapter.mapLine(stop);
  expect(after?.thinking).toBeUndefined();
  expect(after?.events[0]?.type).toBe('raw');
});
