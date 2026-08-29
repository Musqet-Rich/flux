import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

import type { EventInput } from '../create-event-log.ts';
import type { Mapped } from '../create-session-supervisor.ts';
import type { Pending } from './map-claude-line.ts';
import { mapClaudeLine } from './map-claude-line.ts';
import type { ClaudeLine } from './parse-stream-line.ts';
import { parseStreamLine } from './parse-stream-line.ts';

const fixture = new URL('../../test/fixtures/claude/session-two-turns.jsonl', import.meta.url);
const noise = new URL('../../test/fixtures/claude/session-hooks-and-stream.jsonl', import.meta.url);
const cwd =
  '/private/tmp/claude-501/-Users-richhenderson-code-flux/73ccd0c9-0938-49eb-9548-e002f2d31a8d/scratchpad/fixture-repo';

const replay = (source = fixture): { mapped: Mapped[]; events: EventInput[] } => {
  const pending: Pending = { tools: new Map(), thinking: null };
  const lines = readFileSync(source, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '');
  const mapped = lines.map((l) => {
    const parsed: ClaudeLine = parseStreamLine(l) ?? { kind: 'other', data: l };
    return mapClaudeLine(parsed, pending, cwd);
  });
  return { mapped, events: mapped.flatMap((m) => m.events) };
};

// Type plus summary for tool events, type alone otherwise: enough to pin the whole sequence.
const describe = (e: EventInput): string =>
  e.type === 'tool.start' || e.type === 'tool.end' ? `${e.type} ${e.payload.summary}` : e.type;

test('the fixture session maps to the expected event sequence', () => {
  const { events } = replay();
  const shape = events.map((e) => describe(e));
  expect(shape.filter((s) => s !== 'raw')).toEqual([
    'msg.assistant',
    'tool.start Bash: cat notes.txt',
    'rate_limit',
    'tool.end Bash ok, 1 line',
    'tool.start Write greeting.txt',
    'tool.end Write ok',
    'msg.assistant',
    'turn.ended',
    'tool.start Edit greeting.txt',
    'tool.end Edit ok',
    'msg.assistant',
    'turn.ended',
  ]);
});

test('unrecognised lines become raw events so nothing is lost', () => {
  const { events } = replay();
  const raw = events.filter((e) => e.type === 'raw');
  expect(raw.length).toBeGreaterThan(0);
  expect(raw[0]?.payload).toMatchObject({ agent: 'claude' });
});

// Operator hooks and the streaming envelopes around a reply (message_start, content_block_stop,
// thinking deltas, ...) were first seen dogfooding against Claude Code 2.1.251; every one of them
// must land as `raw` or drive the thinking indicator, and none may throw.
test('hook and stream_event lines all map to raw, thinking or context without throwing', () => {
  const { mapped, events } = replay(noise);
  expect(mapped.length).toBeGreaterThan(0);
  const thinking = mapped.filter((m) => m.thinking !== undefined);
  const context = mapped.filter((m) => m.context !== undefined);
  // Every line is exactly one of: a raw/other event, a thinking signal, or a context signal.
  expect(events.length + thinking.length + context.length).toBe(mapped.length);
  expect(new Set(events.map((e) => e.type))).toEqual(new Set(['raw']));
  const subtypes = events.map((e) => JSON.stringify(e.payload));
  expect(subtypes.some((s) => s.includes('"hook_started"'))).toBe(true);
  // message_start now drives the context indicator, not a raw event.
  expect(context.length).toBeGreaterThan(0);
  expect(context.every((m) => m.context?.model === 'claude-fable-5')).toBe(true);
});

const signals = new URL(
  '../../test/fixtures/claude/session-thinking-tasks-pr.jsonl',
  import.meta.url,
);

// The session that opened PR #19 itself: five thinking blocks, four tasks, a push and the PR.
test('thinking, tasks, a push and a published PR are surfaced from the raw log', () => {
  const { mapped, events } = replay(signals);
  expect(events.filter((e) => e.type !== 'raw').map((e) => describe(e))).toEqual([
    'task.started',
    'task.ended',
    'task.started',
    'task.ended',
    'task.started',
    'task.ended',
    'task.started',
    'task.ended',
    'pr.published',
  ]);
  const thinking = mapped.map((m) => m.thinking).filter((t) => t !== undefined);
  expect(thinking.filter((t) => JSON.stringify(t) === '{"active":true}')).toHaveLength(5);
  expect(thinking.filter((t) => JSON.stringify(t) === '{"active":false}')).toHaveLength(5);
  expect(thinking.filter((t) => t.estimatedTokens !== undefined)).toHaveLength(14);
  expect(thinking.slice(0, 4)).toEqual([
    { active: true },
    { active: true, estimatedTokens: 50 },
    { active: true, estimatedTokens: 225 },
    { active: false },
  ]);
  expect(mapped.filter((m) => m.vcsChanged !== undefined).map((m) => m.vcsChanged)).toEqual([
    'push',
  ]);
  expect(events.find((e) => e.type === 'pr.published')?.payload).toEqual({
    provider: 'github',
    url: 'https://github.com/Musqet-Rich/flux/pull/19',
    repo: 'Musqet-Rich/flux',
    identifier: '19',
    action: 'created',
  });
  expect(events.find((e) => e.type === 'task.started')?.payload).toEqual({
    taskId: 'b2p95t4gg',
    toolUseId: 'toolu_017DYy5cyosSSd37SDiYV7vi',
    description: 'Add test and run it',
    background: false,
  });
  expect(events.find((e) => e.type === 'task.ended')?.payload).toEqual({
    taskId: 'b2p95t4gg',
    status: 'completed',
    summary: 'Add test and run it',
  });
  // Every content_block_stop of a text or tool_use block is still raw: 29 stops, 5 thinking.
  const stops = events.filter((e) => JSON.stringify(e.payload).includes('"content_block_stop"'));
  expect(stops).toHaveLength(24);
});

// No hook has failed in a real session yet, so the shape is the documented one with a
// non-success outcome; a stray token count outside a thinking block must not stick the indicator.
test('a failed hook is logged with its stderr capped, a stray token count stays raw', () => {
  const pending: Pending = { tools: new Map(), thinking: null };
  const failed = mapClaudeLine(
    {
      kind: 'hook_failed',
      hookName: 'h',
      hookEvent: 'Stop',
      exitCode: 2,
      stderr: 'x'.repeat(3000),
    },
    pending,
    cwd,
  );
  expect(failed.events[0]?.type).toBe('hook.failed');
  const payload = failed.events[0]?.payload;
  expect(payload).toMatchObject({ hookName: 'h', hookEvent: 'Stop', exitCode: 2 });
  expect(JSON.stringify(payload).length).toBeLessThan(2200);
  expect(JSON.stringify(payload)).toContain('[truncated]');
  const noExit = mapClaudeLine(
    { kind: 'hook_failed', hookName: 'h', hookEvent: 'Stop', stderr: '' },
    pending,
    cwd,
  );
  expect(noExit.events[0]?.payload).toEqual({ hookName: 'h', hookEvent: 'Stop', stderr: '' });
  const stray = mapClaudeLine({ kind: 'thinking_tokens', estimatedTokens: 5 }, pending, cwd);
  expect(stray.thinking).toBeUndefined();
  expect(stray.events[0]?.type).toBe('raw');
});

test('deltas, session id, running and turn flags are surfaced', () => {
  const { mapped } = replay();
  expect(mapped.filter((m) => m.delta !== undefined)).toHaveLength(10);
  expect(mapped.find((m) => m.agentSessionId !== undefined)?.agentSessionId).toBe(
    '86845ede-f4a6-4fc1-a5fb-b6aa1705796b',
  );
  expect(mapped.filter((m) => m.running === true).length).toBeGreaterThan(0);
  expect(mapped.filter((m) => m.turnEnded === true)).toHaveLength(2);
  expect(mapped.filter((m) => m.filesChanged === true)).toHaveLength(3);
});

test('turn.ended carries cost and usage in Flux shape', () => {
  const { events } = replay();
  const turn = events.find((e) => e.type === 'turn.ended');
  expect(turn?.payload).toEqual({
    costUsd: 0.33272199999999996,
    durationMs: expect.any(Number),
    numTurns: 3,
    stopReason: 'end_turn',
    usage: { input: 1576, output: 273, cacheRead: 51612, cacheWrite: 12585 },
  });
});

test('rate_limit windows are normalised to 0..1 and ISO times', () => {
  const { events } = replay();
  const rl = events.find((e) => e.type === 'rate_limit');
  expect(rl?.payload).toEqual({
    windows: [
      { name: 'five_hour', utilisation: 0.07, resetsAt: '2026-08-29T13:50:00.000Z' },
      { name: 'seven_day', utilisation: 0.03, resetsAt: '2026-08-30T03:00:00.000Z' },
      {
        name: 'seven_day_overage_included',
        utilisation: 0.03,
        resetsAt: '2026-08-30T03:00:00.000Z',
      },
    ],
  });
});

test('a failed tool result is not ok, does not flag files, and output is capped', () => {
  const pending: Pending = { tools: new Map([['t1', 'Write']]), thinking: null };
  const line: ClaudeLine = {
    kind: 'tool_result',
    blocks: [
      { type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(70_000), is_error: true },
    ],
    toolUseResult: undefined,
  };
  const mapped = mapClaudeLine(line, pending, cwd);
  expect(mapped.filesChanged).toBe(false);
  expect(mapped.events[0]?.payload).toMatchObject({
    toolId: 't1',
    ok: false,
    summary: 'Write failed',
  });
  const output = JSON.stringify(mapped.events[0]?.payload);
  expect(output.length).toBeLessThan(70_000);
  expect(output).toContain('[truncated');
  expect(pending.tools.size).toBe(0);
});

test('object tool output is kept as is when small, empty text is not a message', () => {
  const pending: Pending = { tools: new Map(), thinking: null };
  const tool = mapClaudeLine(
    {
      kind: 'tool_result',
      blocks: [{ type: 'tool_result', tool_use_id: 'zz', content: [{ a: 1 }] }],
      toolUseResult: null,
    },
    pending,
    cwd,
  );
  expect(tool.events[0]?.payload).toMatchObject({
    ok: true,
    summary: 'unknown ok',
    output: [{ a: 1 }],
  });
  const text = mapClaudeLine(
    { kind: 'assistant', blocks: [{ type: 'text', text: '' }] },
    pending,
    cwd,
  );
  expect(text.events).toEqual([]);
  const status = mapClaudeLine({ kind: 'status', status: 'idle' }, pending, cwd);
  expect(status.running).toBe(false);
  const bare = mapClaudeLine({ kind: 'result', isError: true }, pending, cwd);
  expect(bare.events[0]?.payload).toEqual({});
  const clamped = mapClaudeLine(
    { kind: 'rate_limit', windows: { w: { utilization: 1.5, resetsAt: 0 } } },
    pending,
    cwd,
  );
  expect(clamped.events[0]?.payload).toEqual({
    windows: [{ name: 'w', utilisation: 1, resetsAt: '1970-01-01T00:00:00.000Z' }],
  });
});
