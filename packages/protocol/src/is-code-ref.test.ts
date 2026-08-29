import { expect, test } from 'vitest';

import { isCodeRef } from './is-code-ref.ts';

test.each([
  [{ path: 'a.ts', rev: 'worktree' }, true],
  [{ path: 'a.ts', rev: 'abc', range: { startLine: 1, endLine: 1 } }, true],
  [{ path: 'a.ts', rev: 'abc', range: { startLine: 2, endLine: 1 } }, false],
  [{ path: 'a.ts', rev: 'abc', range: { startLine: 0, endLine: 1 } }, false],
  [{ path: 'a.ts', rev: 'abc', range: { startLine: 1 } }, false],
  [{ path: 'a.ts' }, false],
  [{ rev: 'abc' }, false],
  ['a.ts', false],
])('isCodeRef(%j) is %s', (value, expected) => {
  expect(isCodeRef(value)).toBe(expected);
});
