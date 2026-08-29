import type { FluxEvent } from '@flux/protocol';
import { expect, test } from 'vitest';

import { pendingComments } from './pending-comments.ts';

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
