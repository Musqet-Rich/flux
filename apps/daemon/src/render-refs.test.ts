import { expect, test } from 'vitest';

import { renderRefs } from './render-refs.ts';

const file = 'a\nb\nc\nd\n';

test('a message without refs is unchanged', () => {
  expect(renderRefs('hello', [], [])).toBe('hello');
});

test('a ranged ref renders the path, range and those lines', () => {
  const out = renderRefs(
    'fix this',
    [{ path: 'src/x.ts', rev: 'worktree', range: { startLine: 2, endLine: 3 } }],
    [file],
  );
  expect(out).toBe('fix this\n\n```src/x.ts:2-3\nb\nc\n```');
});

test('a whole-file ref renders up to 200 lines without a range', () => {
  const long = Array.from({ length: 300 }, (_, i) => `l${i}`).join('\n');
  const out = renderRefs('see', [{ path: 'big.ts', rev: 'abc' }], [long]);
  expect(out.startsWith('see\n\n```big.ts\nl0\n')).toBe(true);
  expect(out).toContain('l199\n');
  expect(out).not.toContain('l200\n');
});

test('an unavailable file is marked rather than dropped, and refs keep their order', () => {
  const out = renderRefs(
    'two',
    [
      { path: 'gone.ts', rev: 'worktree', range: { startLine: 1, endLine: 1 } },
      { path: 'a.ts', rev: 'worktree', range: { startLine: 1, endLine: 1 } },
    ],
    [null, file],
  );
  expect(out).toBe('two\n\n```gone.ts:1-1\n(unavailable)\n```\n\n```a.ts:1-1\na\n```');
});
