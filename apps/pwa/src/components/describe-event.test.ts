import type { EventPayloads, EventType, FluxEvent } from '@flux/protocol';
import { expect, test } from 'vitest';

import { describeEvent } from './describe-event.ts';

// Typed by event, so each payload here is one the daemon can emit (packages/protocol).
const ev = <T extends EventType>(type: T, payload: EventPayloads[T]): FluxEvent => ({
  seq: 1,
  ts: '2026-01-01T00:00:00Z',
  session: 's1',
  type,
  payload,
});
const foreign = (type: string, payload: unknown): FluxEvent => ({
  ...ev('raw', { agent: 'x', data: null }),
  type,
  payload,
});

test('messages and tools keep their text, detail and tone', () => {
  expect(describeEvent(ev('msg.user', { text: 'hi', replyTo: 3 }))).toEqual({
    kind: 'user',
    text: 'hi',
    detail: undefined,
    tone: null,
    replyTo: 3,
  });
  expect(describeEvent(ev('msg.assistant', { text: 'yo' }))).toMatchObject({
    kind: 'assistant',
    text: 'yo',
  });
  const start = { toolId: 't1', name: 'Bash', input: { c: 'ls' }, summary: 'Bash: ls' };
  expect(describeEvent(ev('tool.start', start))).toEqual({
    kind: 'tool',
    text: 'Bash: ls',
    detail: { c: 'ls' },
    tone: null,
  });
  const end = { toolId: 't1', ok: false, summary: 'Bash ok', output: 'x' };
  expect(describeEvent(ev('tool.end', end))).toEqual({
    kind: 'tool',
    text: 'Bash ok',
    detail: 'x',
    tone: 'error',
  });
});

test('raw and unknown types show their name with the payload behind a tap', () => {
  expect(describeEvent(ev('raw', { agent: 'claude', data: { type: 'system' } }))).toEqual({
    kind: 'tool',
    text: 'raw event',
    detail: { agent: 'claude', data: { type: 'system' } },
    tone: null,
  });
  expect(describeEvent(foreign('future.thing', 1))).toEqual({
    kind: 'tool',
    text: 'future.thing event',
    detail: 1,
    tone: null,
  });
});

test('task rows carry the icon that marks them', () => {
  const task = { taskId: 't', toolUseId: 'u', description: 'Run tests', background: false };
  expect(describeEvent(ev('task.started', task))).toMatchObject({
    kind: 'task',
    text: 'Task: Run tests',
    task: 'u',
    icon: 'task',
  });
  const ended = { taskId: 't', status: 'completed', summary: 'done', tokens: 1500 };
  expect(describeEvent(ev('task.ended', ended))).toMatchObject({
    kind: 'report',
    text: 'Task completed · 1.5k tokens',
    detail: 'done',
    tone: null,
    icon: 'succeeded',
  });
  expect(
    describeEvent(ev('task.ended', { taskId: 't', status: 'failed', summary: '' })),
  ).toMatchObject({ kind: 'report', detail: undefined, tone: 'warn', icon: 'failed' });
});

test('a PR, a failed hook and a compaction are marked rows too', () => {
  const pr = {
    provider: 'github',
    url: 'https://x/1',
    repo: 'o/r',
    identifier: '1',
    action: 'created',
  };
  expect(describeEvent(ev('pr.published', pr))).toMatchObject({
    kind: 'link',
    text: 'Pull request #1 created · o/r',
    href: 'https://x/1',
    tone: 'ok',
    icon: 'pullRequest',
  });
  const hook = { hookName: 'Stop', hookEvent: 'Stop', exitCode: 2, stderr: 'boom' };
  expect(describeEvent(ev('hook.failed', hook))).toMatchObject({
    kind: 'warning',
    text: 'Hook Stop failed (exit 2)',
    detail: 'boom',
    icon: 'warning',
  });
  const compact = {
    trigger: 'auto',
    preTokens: 60065,
    postTokens: 6202,
    durationMs: 59400,
    result: 'success',
  };
  expect(describeEvent(ev('compact.boundary', compact))).toMatchObject({
    kind: 'divider',
    text: 'Context compacted · 60k → 6.2k tokens · 59s',
    icon: 'compact',
  });
  expect(describeEvent(ev('compact.boundary', { ...compact, result: 'failure' }))).toMatchObject({
    kind: 'divider',
    text: 'Compaction failed',
    tone: 'warn',
    icon: 'warning',
  });
});

test('lifecycle and interaction rows are one-line notes without an icon', () => {
  const created = {
    repo: '/r',
    worktree: '/w',
    branch: 'b',
    base: 'c',
    harness: 'claude',
  } as const;
  const rows: [FluxEvent, string, 'ok' | 'warn' | 'error' | null][] = [
    [ev('session.created', created), 'Session started on b', null],
    [ev('session.state', { state: 'waiting_user' }), 'Agent waiting user', null],
    [ev('session.state', { state: 'ended', reason: 'x' }), 'Agent ended', 'warn'],
    [ev('session.head', { head: 'feat/x' }), 'Now on feat/x', null],
    [ev('turn.ended', { costUsd: 0.5 }), 'Turn ended · $0.500', null],
    [ev('agent.spec', { model: 'm', effort: 'high' }), 'Running m:high', null],
    [ev('ask', { askId: 'q', question: 'Go?', timeoutAt: 'x' }), 'Asked: Go?', 'warn'],
    [ev('notify', { level: 'blocked', summary: 'stuck' }), 'stuck', 'error'],
    [ev('notify', { level: 'done', summary: 'ok' }), 'ok', 'ok'],
    [ev('comment.sent', { commentIds: ['a', 'b'], msgSeq: 4 }), '2 comment(s) sent', null],
    [
      ev('manager.acted', { actor: 'm1', action: 'send', target: 's2', detail: 'hi' }),
      'Manager · sent to s2: hi',
      null,
    ],
    [
      ev('manager.acted', { actor: 'm1', action: 'open', target: 's2', detail: '' }),
      'Manager · opened session s2',
      null,
    ],
    [ev('task.progress', { taskId: 't', description: 'n' }), 'task.progress event', null],
  ];
  for (const [event, text, tone] of rows) {
    expect(describeEvent(event)).toEqual({ kind: 'note', text, detail: undefined, tone });
  }
  expect(describeEvent(ev('session.cleared', {}))).toEqual({
    kind: 'divider',
    text: 'Context cleared',
    detail: undefined,
    tone: null,
  });
});
