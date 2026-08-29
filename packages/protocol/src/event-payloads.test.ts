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
    { repo: '/r', worktree: '/w', branch: 'b', base: 'abc', agent: 'claude' },
    true,
  ],
  [
    'session.created',
    {
      repo: '/r',
      worktree: '/w',
      branch: 'b',
      base: 'abc',
      agent: 'pi',
      agentSessionId: 'x',
      title: 't',
    },
    true,
  ],
  [
    'session.created',
    { repo: '/r', worktree: '/w', branch: 'b', base: 'abc', agent: 'gpt' },
    false,
  ],
  ['session.created', { repo: '/r', worktree: '/w', branch: 'b', agent: 'claude' }, false],
  [
    'session.created',
    { repo: '/r', worktree: '/w', branch: 'b', base: 'abc', agent: 'claude', title: 1 },
    false,
  ],
  ['session.state', { state: 'idle' }, true],
  ['session.state', { state: 'ended', reason: 'exit 1' }, true],
  ['session.state', { state: 'paused' }, false],
  ['session.state', { state: 'idle', reason: null }, false],
  ['session.renamed', { title: 'x' }, true],
  ['session.renamed', {}, false],
  ['msg.user', { text: 'hi' }, true],
  ['msg.user', { text: 'hi', refs: [ref], commentIds: ['c1'] }, true],
  ['msg.user', { text: 'hi', refs: [{ path: 'a' }] }, false],
  ['msg.user', { text: 'hi', refs: [{ ...ref, range: { startLine: 3, endLine: 1 } }] }, false],
  ['msg.user', { text: 'hi', refs: [{ ...ref, range: { startLine: 0, endLine: 1 } }] }, false],
  ['msg.user', { text: 'hi', commentIds: [1] }, false],
  ['msg.user', { text: 1 }, false],
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
