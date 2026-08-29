import { expect, test } from 'vitest';

import { createCommentStore } from './create-comment-store.ts';
import { DaemonError } from './daemon-error.ts';
import { openDatabase } from './open-database.ts';

const ref = { path: 'a.ts', rev: 'worktree', range: { startLine: 1, endLine: 2 } };

test('comments queue per session and are marked sent', () => {
  const store = createCommentStore(openDatabase(':memory:'));
  const a = store.add('s', ref, 'first');
  const b = store.add('s', { path: 'b.ts', rev: 'abc' }, 'second');
  store.add('other', ref, 'elsewhere');
  expect(store.pending('s')).toEqual([a, b]);
  expect(store.get('s', [b.commentId, a.commentId])).toEqual([b, a]);
  store.markSent([a.commentId], 9);
  expect(store.pending('s')).toEqual([b]);
  expect(store.get('s', [a.commentId])[0]?.sentSeq).toBe(9);
});

test('remove deletes, unknown ids are not_found', () => {
  const store = createCommentStore(openDatabase(':memory:'));
  const a = store.add('s', ref, 'x');
  store.remove('s', a.commentId);
  expect(store.pending('s')).toEqual([]);
  expect(() => {
    store.remove('s', a.commentId);
  }).toThrow(DaemonError);
  expect(() => store.get('s', ['nope'])).toThrow(DaemonError);
});
