import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

import { parseStreamLine } from './parse-stream-line.ts';

const fixture = new URL('../../test/fixtures/claude/session-two-turns.jsonl', import.meta.url);
const lines = readFileSync(fixture, 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '');

test('every fixture line parses to a known kind', () => {
  const kinds = lines.map((l) => String(parseStreamLine(l)?.kind));
  expect(kinds).not.toContain('undefined');
  expect(new Set(kinds)).toEqual(
    new Set([
      'init',
      'status',
      'delta',
      'assistant',
      'tool_result',
      'result',
      'rate_limit',
      'block_stop',
      'other',
    ]),
  );
});

const signals = readFileSync(
  new URL('../../test/fixtures/claude/session-thinking-tasks-pr.jsonl', import.meta.url),
  'utf8',
)
  .split('\n')
  .filter((l) => l.trim() !== '')
  .map((l) => parseStreamLine(l));

test('the signal session parses thinking, tasks, the push and the PR', () => {
  const kinds = signals.map((l) => String(l?.kind));
  expect(kinds).not.toContain('undefined');
  expect(kinds.filter((k) => k === 'thinking_start')).toHaveLength(5);
  expect(kinds.filter((k) => k === 'thinking_tokens')).toHaveLength(14);
  expect(kinds.filter((k) => k === 'block_stop')).toHaveLength(29);
  expect(kinds.filter((k) => k === 'task_started')).toHaveLength(4);
  expect(kinds.filter((k) => k === 'task_ended')).toHaveLength(4);
  expect(signals.find((l) => l?.kind === 'thinking_start')).toEqual({
    kind: 'thinking_start',
    index: 0,
  });
  expect(signals.find((l) => l?.kind === 'thinking_tokens')).toEqual({
    kind: 'thinking_tokens',
    estimatedTokens: 50,
  });
  expect(signals.find((l) => l?.kind === 'vcs_changed')).toEqual({
    kind: 'vcs_changed',
    vcsKind: 'push',
  });
  expect(signals.find((l) => l?.kind === 'pr_published')).toEqual({
    kind: 'pr_published',
    provider: 'github',
    url: 'https://github.com/Musqet-Rich/flux/pull/19',
    repo: 'Musqet-Rich/flux',
    identifier: '19',
    action: 'created',
  });
  // Successful hooks stay unread; the fixture has two.
  expect(kinds.filter((k) => k === 'hook_failed')).toHaveLength(0);
});

const hookLine = (extra: Record<string, unknown>): string =>
  JSON.stringify({
    type: 'system',
    subtype: 'hook_response',
    hook_name: 'Stop:lint',
    hook_event: 'Stop',
    outcome: 'failure',
    ...extra,
  });

test('a hook_response that did not succeed parses as hook_failed', () => {
  const line = hookLine;
  expect(parseStreamLine(line({ exit_code: 2, stderr: 'lint failed' }))).toEqual({
    kind: 'hook_failed',
    hookName: 'Stop:lint',
    hookEvent: 'Stop',
    exitCode: 2,
    stderr: 'lint failed',
  });
  expect(parseStreamLine(line({ exit_code: null, stderr: 7 }))).toEqual({
    kind: 'hook_failed',
    hookName: 'Stop:lint',
    hookEvent: 'Stop',
    stderr: '',
  });
  const ok = JSON.stringify({ type: 'system', subtype: 'hook_response', outcome: 'success' });
  expect(parseStreamLine(ok)?.kind).toBe('other');
});

test('malformed signals fall back to other rather than half-parsed', () => {
  const bad = [
    { type: 'system', subtype: 'thinking_tokens', estimated_tokens: 'many' },
    { type: 'system', subtype: 'task_started', task_id: 1 },
    { type: 'system', subtype: 'task_notification', task_id: 't' },
    { type: 'system', subtype: 'code_change_published', provider: 'github' },
    { type: 'system', subtype: 'vcs_state_changed' },
    { type: 'stream_event', event: 'nope' },
    {
      type: 'stream_event',
      event: { type: 'content_block_start', content_block: { type: 'text' } },
    },
    { type: 'stream_event', event: { type: 'content_block_stop' } },
  ];
  for (const value of bad) expect(parseStreamLine(JSON.stringify(value))?.kind).toBe('other');
});

test('init carries the agent session id and model', () => {
  const init = lines.map((l) => parseStreamLine(l)).find((l) => l?.kind === 'init');
  expect(init).toEqual({
    kind: 'init',
    sessionId: '86845ede-f4a6-4fc1-a5fb-b6aa1705796b',
    model: 'claude-fable-5',
  });
});

test('assistant lines keep text and tool_use blocks in order', () => {
  const assistants = lines.map((l) => parseStreamLine(l)).filter((l) => l?.kind === 'assistant');
  expect(assistants).toHaveLength(6);
  expect(assistants[1]).toEqual({
    kind: 'assistant',
    blocks: [
      {
        type: 'tool_use',
        id: 'toolu_01SXSGmuagPAivXiDZ7sqmKR',
        name: 'Bash',
        input: { command: 'cat notes.txt', description: 'Print notes.txt' },
      },
    ],
  });
});

test('tool results carry the block and the structured tool_use_result', () => {
  const results = lines.map((l) => parseStreamLine(l)).filter((l) => l?.kind === 'tool_result');
  expect(results).toHaveLength(3);
  expect(results[0]).toEqual({
    kind: 'tool_result',
    blocks: [
      {
        type: 'tool_result',
        tool_use_id: 'toolu_01SXSGmuagPAivXiDZ7sqmKR',
        content: 'hello',
        is_error: false,
      },
    ],
    toolUseResult: {
      stdout: 'hello',
      stderr: '',
      interrupted: false,
      isImage: false,
      noOutputExpected: false,
    },
  });
});

test('result lines carry cost, duration, turns and usage', () => {
  const results = lines.map((l) => parseStreamLine(l)).filter((l) => l?.kind === 'result');
  expect(results).toHaveLength(2);
  expect(results[0]).toMatchObject({
    kind: 'result',
    isError: false,
    costUsd: 0.33272199999999996,
    numTurns: 3,
    stopReason: 'end_turn',
    usage: { input_tokens: 1576, output_tokens: 273, cache_read_input_tokens: 51612 },
  });
});

test('rate limit lines expose the unified windows', () => {
  const rl = lines.map((l) => parseStreamLine(l)).find((l) => l?.kind === 'rate_limit');
  expect(rl).toMatchObject({
    kind: 'rate_limit',
    windows: { five_hour: { utilization: 0.07, resetsAt: 1788011400 } },
  });
});

test('text deltas are extracted and other stream events are other', () => {
  const parsed = lines.map((l) => parseStreamLine(l));
  const deltas = parsed.filter((l) => l?.kind === 'delta');
  expect(deltas).toHaveLength(10);
  expect(deltas[0]).toEqual({ kind: 'delta', text: 'Re' });
  const others = parsed.filter((l) => l?.kind === 'other');
  expect(others.length).toBeGreaterThan(0);
});

test.each([
  ['not json', null],
  ['[1,2]', null],
  ['"str"', null],
  [
    '{"type":"system","subtype":"weird"}',
    { kind: 'other', data: { type: 'system', subtype: 'weird' } },
  ],
  ['{"type":"system","subtype":"status","status":"idle"}', { kind: 'status', status: 'idle' }],
  [
    '{"type":"stream_event","event":{"type":"message_stop"}}',
    { kind: 'other', data: { type: 'stream_event', event: { type: 'message_stop' } } },
  ],
  [
    '{"type":"user","message":{"role":"user","content":"typed text"}}',
    { kind: 'other', data: { type: 'user', message: { role: 'user', content: 'typed text' } } },
  ],
  [
    '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"..."}]}}',
    { kind: 'assistant', blocks: [] },
  ],
  ['{"type":"result","is_error":true}', { kind: 'result', isError: true }],
  [
    '{"type":"rate_limit_event","rate_limit_info":{}}',
    { kind: 'other', data: { type: 'rate_limit_event', rate_limit_info: {} } },
  ],
  [
    '{"type":"rate_limit_event","rate_limit_info":{"unifiedWindows":{"a":{"utilization":"x"},"b":{"utilization":0.5,"resetsAt":1}}}}',
    { kind: 'rate_limit', windows: { b: { utilization: 0.5, resetsAt: 1 } } },
  ],
  ['{"type":"tool_progress"}', { kind: 'other', data: { type: 'tool_progress' } }],
])('parseStreamLine(%s)', (input, expected) => {
  expect(parseStreamLine(input)).toEqual(expected);
});
