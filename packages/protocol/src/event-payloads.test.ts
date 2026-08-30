import { expect, test } from 'vitest';

import type { EventType } from './event-payloads.ts';
import { eventPayloads } from './event-payloads.ts';

const ref = { path: 'src/a.ts', rev: 'worktree', range: { startLine: 1, endLine: 3 } };
const usage = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 };

// [type, value, accepted]. Each type has its minimal valid payload, a fuller one where optional
// fields exist, and one rejection per field or constraint.
const cases: [EventType, unknown, boolean][] = [
  [
    'session.created',
    { repo: '/r', worktree: '/w', branch: 'b', base: 'abc', harness: 'claude' },
    true,
  ],
  [
    'session.created',
    {
      repo: '/r',
      worktree: '/w',
      branch: 'b',
      base: 'abc',
      harness: 'pi',
      agentSessionId: 'x',
      title: 't',
    },
    true,
  ],
  [
    'session.created',
    { repo: '/r', worktree: '/w', branch: 'b', base: 'abc', harness: 'gpt' },
    false,
  ],
  ['session.created', { repo: '/r', worktree: '/w', branch: 'b', harness: 'claude' }, false],
  [
    'session.created',
    { repo: '/r', worktree: '/w', branch: 'b', base: 'abc', harness: 'claude', title: 1 },
    false,
  ],
  ['session.state', { state: 'idle' }, true],
  ['session.state', { state: 'ended', reason: 'exit 1' }, true],
  ['session.state', { state: 'paused' }, false],
  ['session.state', { state: 'idle', reason: null }, false],
  ['session.renamed', { title: 'x' }, true],
  ['session.renamed', {}, false],
  ['session.cleared', {}, true],
  ['session.cleared', null, false],
  ['msg.user', { text: 'hi' }, true],
  ['msg.user', { text: 'hi', refs: [ref], commentIds: ['c1'] }, true],
  ['msg.user', { text: 'hi', refs: [{ path: 'a' }] }, false],
  ['msg.user', { text: 'hi', refs: [{ ...ref, range: { startLine: 3, endLine: 1 } }] }, false],
  ['msg.user', { text: 'hi', refs: [{ ...ref, range: { startLine: 0, endLine: 1 } }] }, false],
  ['msg.user', { text: 'hi', commentIds: [1] }, false],
  ['msg.user', { text: 'hi', replyTo: 3 }, true],
  ['msg.user', { text: 'hi', replyTo: 0 }, false],
  ['msg.user', { text: 'hi', replyTo: '3' }, false],
  ['msg.user', { text: 1 }, false],
  [
    'msg.user',
    {
      text: 'hi',
      attachments: [{ id: 'a', name: 'n', mime: 'text/plain', size: 1, image: false }],
    },
    true,
  ],
  ['msg.user', { text: 'hi', attachments: [{ id: 'a', name: 'n' }] }, false],
  ['msg.user', { text: 'hi', attachments: 'a' }, false],
  ['msg.assistant', { text: '' }, true],
  ['msg.assistant', { text: undefined }, false],
  ['tool.start', { toolId: 't', name: 'Bash', input: null, summary: 's' }, true],
  ['tool.start', { toolId: 't', name: 'Bash', summary: 's' }, false],
  ['tool.start', { toolId: 't', name: 'Bash', input: {}, summary: 2 }, false],
  ['tool.end', { toolId: 't', ok: true, summary: 's' }, true],
  ['tool.end', { toolId: 't', ok: false, summary: 's', output: 'anything' }, true],
  ['tool.end', { toolId: 't', ok: 'yes', summary: 's' }, false],
  ['turn.ended', {}, true],
  ['turn.ended', { costUsd: 0.5, durationMs: 10, numTurns: 1, stopReason: 'end', usage }, true],
  ['turn.ended', { usage: { ...usage, cacheWrite: -1 } }, false],
  ['turn.ended', { durationMs: 1.5 }, false],
  ['turn.ended', { costUsd: 'free' }, false],
  ['rate_limit', { windows: [] }, true],
  ['rate_limit', { windows: [{ name: '5h', utilisation: 0.4, resetsAt: 'ts' }] }, true],
  ['rate_limit', { windows: [{ name: '5h', utilisation: 1.4, resetsAt: 'ts' }] }, false],
  ['rate_limit', { windows: [{ name: '5h', utilisation: -0.1, resetsAt: 'ts' }] }, false],
  ['rate_limit', { windows: [{ name: '5h', utilisation: 0.1 }] }, false],
  ['rate_limit', { windows: {} }, false],
  ['ask', { askId: 'a', question: 'q', timeoutAt: 'ts' }, true],
  ['ask', { askId: 'a', question: 'q', options: ['y', 'n'], timeoutAt: 'ts' }, true],
  ['ask', { askId: 'a', question: 'q', options: 'y', timeoutAt: 'ts' }, false],
  ['ask', { askId: 'a', question: 'q' }, false],
  ['ask.answered', { askId: 'a', answer: 'y', by: 'device' }, true],
  ['ask.answered', { askId: 'a', answer: 'y', by: 'timeout' }, true],
  ['ask.answered', { askId: 'a', answer: '', by: 'aborted' }, true],
  ['ask.answered', { askId: 'a', answer: 'y', by: 'box' }, false],
  ['notify', { level: 'done', summary: 's' }, true],
  ['notify', { level: 'urgent', summary: 's' }, false],
  ['files.changed', { files: [] }, true],
  ['files.changed', { files: [{ path: 'a', status: 'R', from: 'b' }] }, true],
  ['files.changed', { files: [{ path: 'a', status: 'X' }] }, false],
  ['files.changed', { files: [{ path: 'a', status: 'M', from: 1 }] }, false],
  ['comment.added', { commentId: 'c', ref, text: 't' }, true],
  ['comment.added', { commentId: 'c', ref: { path: 'a', rev: 'r' }, text: 't' }, true],
  ['comment.added', { commentId: 'c', ref: {}, text: 't' }, false],
  ['comment.removed', { commentId: 'c' }, true],
  ['comment.removed', { commentId: 1 }, false],
  ['comment.sent', { commentIds: ['c'], msgSeq: 4 }, true],
  ['comment.sent', { commentIds: ['c'], msgSeq: 0 }, false],
  ['task.started', { taskId: 't', toolUseId: 'u', description: 'd', background: false }, true],
  ['task.started', { taskId: 't', toolUseId: 'u', description: 'd' }, false],
  ['task.started', { taskId: 't', toolUseId: 'u', description: 1, background: true }, false],
  [
    'task.started',
    { taskId: 't', toolUseId: 'u', description: 'd', background: false, agentType: 'Explore' },
    true,
  ],
  [
    'task.started',
    { taskId: 't', toolUseId: 'u', description: 'd', background: false, agentType: 1 },
    false,
  ],
  ['task.progress', { taskId: 't', description: 'Reading a.txt' }, true],
  ['task.progress', { taskId: 't', description: 'Reading a.txt', tokens: 11717 }, true],
  ['task.progress', { taskId: 't', description: 'Reading a.txt', tokens: 'many' }, false],
  ['task.progress', { taskId: 't' }, false],
  ['task.ended', { taskId: 't', status: 'completed', summary: 's' }, true],
  ['task.ended', { taskId: 't', status: 'whatever_comes_next', summary: 's' }, true],
  ['task.ended', { taskId: 't', status: 1, summary: 's' }, false],
  ['task.ended', { taskId: 't', status: 'failed' }, false],
  ['task.ended', { taskId: 't', status: 'completed', summary: 's', tokens: 12070 }, true],
  ['task.ended', { taskId: 't', status: 'completed', summary: 's', tokens: 1.5 }, false],
  [
    'pr.published',
    {
      provider: 'github',
      url: 'https://x/pull/1',
      repo: 'o/r',
      identifier: '1',
      action: 'created',
    },
    true,
  ],
  ['pr.published', { provider: 'github', url: 'https://x/pull/1', repo: 'o/r' }, false],
  [
    'pr.published',
    { provider: 'github', url: 'https://x/pull/1', repo: 'o/r', identifier: 1, action: 'created' },
    false,
  ],
  ['hook.failed', { hookName: 'h', hookEvent: 'Stop', stderr: '' }, true],
  ['hook.failed', { hookName: 'h', hookEvent: 'Stop', exitCode: 2, stderr: 'boom' }, true],
  ['hook.failed', { hookName: 'h', hookEvent: 'Stop', exitCode: 'two', stderr: 'boom' }, false],
  ['hook.failed', { hookName: 'h', hookEvent: 'Stop' }, false],
  [
    'compact.boundary',
    { trigger: 'manual', preTokens: 60065, postTokens: 6202, durationMs: 59369, result: 'success' },
    true,
  ],
  [
    'compact.boundary',
    { trigger: 'manual', preTokens: 0, postTokens: 0, durationMs: 0, result: 'failure' },
    true,
  ],
  [
    'compact.boundary',
    { trigger: 'manual', preTokens: 60065, postTokens: 6202, durationMs: 59369 },
    false,
  ],
  [
    'compact.boundary',
    { trigger: 1, preTokens: 60065, postTokens: 6202, durationMs: 59369, result: 'success' },
    false,
  ],
  [
    'compact.boundary',
    { trigger: 'manual', preTokens: 1.5, postTokens: 6202, durationMs: 59369, result: 'success' },
    false,
  ],
  [
    'compact.boundary',
    { trigger: 'manual', preTokens: 60065, postTokens: -1, durationMs: 59369, result: 'success' },
    false,
  ],
  [
    'compact.boundary',
    {
      trigger: 'manual',
      preTokens: 60065,
      postTokens: 6202,
      durationMs: '59369',
      result: 'success',
    },
    false,
  ],
  [
    'compact.boundary',
    { trigger: 'manual', preTokens: 60065, postTokens: 6202, durationMs: 59369, result: 5 },
    false,
  ],
  [
    'manager.acted',
    { actor: 's1', action: 'open', target: 's2', detail: 'claude on flux/x' },
    true,
  ],
  ['manager.acted', { actor: 's1', action: 'send', target: 's2', detail: 'hi' }, true],
  ['manager.acted', { actor: 's1', action: 'close', target: 's2', detail: 'archived' }, true],
  ['manager.acted', { actor: 's1', action: 'read', target: 's2', detail: '3 events' }, true],
  // `list` is read-only and not audited, so it is not an action value.
  ['manager.acted', { actor: 's1', action: 'list', target: 's2', detail: 'x' }, false],
  ['manager.acted', { actor: 's1', action: 'send', target: 's2' }, false],
  ['manager.acted', { actor: 's1', action: 'send', target: 5, detail: 'x' }, false],
  ['manager.acted', { actor: 1, action: 'send', target: 's2', detail: 'x' }, false],
  ['raw', { agent: 'claude', data: { anything: true } }, true],
  ['raw', { agent: 'claude' }, false],
];

test.each(cases)('%s payload %j accepted=%s', (type, value, expected) => {
  expect(eventPayloads[type](value)).toBe(expected);
});

test.each(Object.keys(eventPayloads))('%s rejects non-records', (type) => {
  expect(eventPayloads[type as EventType]('x')).toBe(false);
  expect(eventPayloads[type as EventType](null)).toBe(false);
});
