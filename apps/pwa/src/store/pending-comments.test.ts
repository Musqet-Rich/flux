import type { FluxEvent } from '@flux/protocol';
import { expect, test } from 'vitest';

import { logFold } from './log-fold.ts';
import { pendingComments as fold } from './pending-comments.ts';

const pendingComments = (events: FluxEvent[]) => [...logFold.run(events, fold).added.values()];

const ev = (seq: number, type: string, payload: unknown): FluxEvent => ({
  seq,
  ts: '2026-01-01T00:00:00Z',
  session: 's1',
  type,
  payload,
});

const ref = { path: 'a.ts', rev: 'worktree', range: { startLine: 1, endLine: 1 } };

test('keeps comments that were neither sent nor removed, in order', () => {
  const events = [
    ev(1, 'comment.added', { commentId: 'a', ref, text: 'A' }),
    ev(2, 'comment.added', { commentId: 'b', ref, text: 'B' }),
    ev(3, 'comment.added', { commentId: 'c', ref, text: 'C' }),
    ev(4, 'comment.removed', { commentId: 'b' }),
    ev(5, 'msg.user', { text: 'x', commentIds: ['a'] }),
    ev(6, 'comment.sent', { commentIds: ['a'], msgSeq: 5 }),
    ev(7, 'comment.added', { commentId: 'd', ref, text: 'D' }),
  ];
  expect(pendingComments(events).map((c) => c.commentId)).toEqual(['c', 'd']);
  expect(pendingComments([])).toEqual([]);
});

// Stepped one event at a time, as the screen keeps it: a comment event returns a fresh value
// over the same map, anything that changes nothing the value given.
test('the fold returns a new value for a change and the old one for none', () => {
  const { step } = fold;
  const first = fold.init();
  const added = step(first, ev(1, 'comment.added', { commentId: 'a', ref, text: 'A' }));
  expect(added).not.toBe(first);
  expect(added.added).toBe(first.added);
  expect(step(added, ev(2, 'msg.user', { text: 'x' }))).toBe(added);
  expect(step(added, ev(3, 'comment.removed', { commentId: 'zz' }))).toBe(added);
  expect(step(added, ev(4, 'comment.sent', { commentIds: ['zz'], msgSeq: 2 }))).toBe(added);
  const sent = step(added, ev(5, 'comment.sent', { commentIds: ['a'], msgSeq: 2 }));
  expect(sent).not.toBe(added);
  expect([...sent.added.keys()]).toEqual([]);
});
