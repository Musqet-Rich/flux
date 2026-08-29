import { expect, test } from 'vitest';

import type { InlineNode } from './inline-markdown.ts';
import { inlineMarkdown } from './inline-markdown.ts';

const text = (t: string): InlineNode => ({ kind: 'text', text: t });

const cases: [string, string, InlineNode[]][] = [
  ['plain', 'hello', [text('hello')]],
  ['empty', '', []],
  ['code', 'a `b` c', [text('a '), { kind: 'code', text: 'b' }, text(' c')]],
  ['unclosed backtick is literal', 'a `b', [text('a `b')]],
  ['empty code span is literal', 'a `` b', [text('a `` b')]],
  ['code is not parsed inside', '`**x**`', [{ kind: 'code', text: '**x**' }]],
  ['strong', '**a**', [{ kind: 'strong', children: [text('a')] }]],
  ['em', '*a*', [{ kind: 'em', children: [text('a')] }]],
  [
    'nested',
    '**a *b* `c`**',
    [
      {
        kind: 'strong',
        children: [
          text('a '),
          { kind: 'em', children: [text('b')] },
          text(' '),
          { kind: 'code', text: 'c' },
        ],
      },
    ],
  ],
  ['arithmetic stars stay literal', '2 * 3 * 4', [text('2 * 3 * 4')]],
  ['unclosed strong is literal', '**a', [text('**a')]],
  ['empty strong is literal', '****', [text('****')]],
  [
    'https link',
    'see [docs](https://example.com/a?b=1) now',
    [
      text('see '),
      { kind: 'link', href: 'https://example.com/a?b=1', children: [text('docs')] },
      text(' now'),
    ],
  ],
  ['http link', '[x](http://h)', [{ kind: 'link', href: 'http://h/', children: [text('x')] }]],
  ['javascript link is literal', '[x](javascript:alert(1))', [text('[x](javascript:alert(1))')]],
  ['data link is literal', '[x](data:text/html,hi)', [text('[x](data:text/html,hi)')]],
  ['relative link is literal', '[x](/etc/passwd)', [text('[x](/etc/passwd)')]],
  ['bracket without paren is literal', '[a] b', [text('[a] b')]],
  ['unclosed paren is literal', '[a](https://x', [text('[a](https://x')]],
  [
    'quote in the URL cannot escape the attribute',
    '[a](https://x/" onclick="y)',
    [{ kind: 'link', href: 'https://x/%22%20onclick=%22y', children: [text('a')] }],
  ],
  ['html is text', '<script>alert(1)</script>', [text('<script>alert(1)</script>')]],
  [
    'a dead bracket does not hide a later link',
    '[a] [b](https://x/)',
    [text('[a] '), { kind: 'link', href: 'https://x/', children: [text('b')] }],
  ],
  [
    'a bracket inside a label is part of the label',
    '[a [b](https://x/)',
    [{ kind: 'link', href: 'https://x/', children: [text('a [b')] }],
  ],
  [
    'a label cannot hold a link',
    '[[b](https://x/)](https://y/)',
    [{ kind: 'link', href: 'https://x/', children: [text('[b')] }, text('](https://y/)')],
  ],
];

test.each(cases)('%s', (_name, input, expected) => {
  expect(inlineMarkdown(input)).toEqual(expected);
});

// Brackets that never close, or close without a URL, must not make the scan rescan to the same
// `]` from every `[`: 200 KB of them is one text run, found in one pass.
test('a wall of brackets is one text run', () => {
  for (const wall of [
    '['.repeat(200 * 1024),
    '[x]('.repeat(50 * 1024),
    `${'['.repeat(200 * 1024)}]`,
  ]) {
    expect(inlineMarkdown(wall)).toEqual([text(wall)]);
  }
});
