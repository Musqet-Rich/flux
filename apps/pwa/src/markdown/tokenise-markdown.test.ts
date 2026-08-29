import { expect, test } from 'vitest';

import type { MarkdownBlock } from './tokenise-markdown.ts';
import { tokeniseMarkdown } from './tokenise-markdown.ts';

const cases: [string, string, MarkdownBlock[]][] = [
  ['empty', '', []],
  ['blank lines only', '\n\n  \n', []],
  [
    'paragraphs split on blank lines, line breaks kept',
    'one\ntwo\n\nthree',
    [
      { kind: 'paragraph', lines: ['one', 'two'] },
      { kind: 'paragraph', lines: ['three'] },
    ],
  ],
  [
    'CRLF is fine',
    'a\r\n\r\nb',
    [
      { kind: 'paragraph', lines: ['a'] },
      { kind: 'paragraph', lines: ['b'] },
    ],
  ],
  [
    'headings up to three levels; four hashes is text',
    '# One\n## Two\n### Three\n#### Four\n#NotAHeading',
    [
      { kind: 'heading', level: 1, text: 'One' },
      { kind: 'heading', level: 2, text: 'Two' },
      { kind: 'heading', level: 3, text: 'Three' },
      { kind: 'paragraph', lines: ['#### Four', '#NotAHeading'] },
    ],
  ],
  [
    'fenced code keeps its text verbatim and its language',
    'before\n```ts\nconst a = 1;\n\n# not a heading\n```\nafter',
    [
      { kind: 'paragraph', lines: ['before'] },
      { kind: 'code', lang: 'ts', text: 'const a = 1;\n\n# not a heading', closed: true },
      { kind: 'paragraph', lines: ['after'] },
    ],
  ],
  [
    'an unclosed fence (streaming) is an open code block',
    'text\n```\nstill typ',
    [
      { kind: 'paragraph', lines: ['text'] },
      { kind: 'code', lang: '', text: 'still typ', closed: false },
    ],
  ],
  [
    'a bare fence at the end is an empty open block',
    '```',
    [{ kind: 'code', lang: '', text: '', closed: false }],
  ],
  [
    'pipe tables: alignment, escaped pipes, ragged rows, no outer pipes',
    'before\n| Name | N | Note |\n|:-----|--:|:---:|\n| a \\| b | 1 |\n| c | 2 | x | extra |\nx | y | z\n\n| solo |\n|---|\nafter',
    [
      { kind: 'paragraph', lines: ['before'] },
      {
        kind: 'table',
        align: ['left', 'right', 'center'],
        header: ['Name', 'N', 'Note'],
        rows: [
          ['a | b', '1', ''],
          ['c', '2', 'x'],
          ['x', 'y', 'z'],
        ],
      },
      { kind: 'table', align: [null], header: ['solo'], rows: [['after']] },
    ],
  ],
  [
    'a pipe row without a delimiter row, or with the wrong width, is a paragraph',
    '| a | b |\n| just text |\n\n| a | b |\n|---|',
    [
      { kind: 'paragraph', lines: ['| a | b |', '| just text |'] },
      { kind: 'paragraph', lines: ['| a | b |', '|---|'] },
    ],
  ],
  [
    'a table ends a paragraph and a list',
    'p\n| h |\n|---|\n| r |\n- i\n| h2 |\n|---|',
    [
      { kind: 'paragraph', lines: ['p'] },
      { kind: 'table', align: [null], header: ['h'], rows: [['r']] },
      { kind: 'list', ordered: false, items: [{ lines: ['i'], nested: null }] },
      { kind: 'table', align: [null], header: ['h2'], rows: [] },
    ],
  ],
  [
    'unordered and ordered lists with one level of nesting',
    '- a\n- b\n  1. b1\n  2. b2\n- c\n  more c\n\n1. x\n2. y',
    [
      {
        kind: 'list',
        ordered: false,
        items: [
          { lines: ['a'], nested: null },
          {
            lines: ['b'],
            nested: {
              kind: 'list',
              ordered: true,
              items: [
                { lines: ['b1'], nested: null },
                { lines: ['b2'], nested: null },
              ],
            },
          },
          { lines: ['c', 'more c'], nested: null },
        ],
      },
      {
        kind: 'list',
        ordered: true,
        items: [
          { lines: ['x'], nested: null },
          { lines: ['y'], nested: null },
        ],
      },
    ],
  ],
  [
    'a list ends at a blank line followed by prose',
    '* a\n* b\n\ndone',
    [
      {
        kind: 'list',
        ordered: false,
        items: [
          { lines: ['a'], nested: null },
          { lines: ['b'], nested: null },
        ],
      },
      { kind: 'paragraph', lines: ['done'] },
    ],
  ],
  [
    'blockquotes',
    '> quoted\n> twice\nnot quoted',
    [
      { kind: 'quote', lines: ['quoted', 'twice'] },
      { kind: 'paragraph', lines: ['not quoted'] },
    ],
  ],
  [
    'a list or heading interrupts a paragraph',
    'intro\n- item\n# head',
    [
      { kind: 'paragraph', lines: ['intro'] },
      { kind: 'list', ordered: false, items: [{ lines: ['item'], nested: null }] },
      { kind: 'heading', level: 1, text: 'head' },
    ],
  ],
  [
    'a star without a space is not a list',
    '*bold* text',
    [{ kind: 'paragraph', lines: ['*bold* text'] }],
  ],
];

test.each(cases)('%s', (_name, input, expected) => {
  expect(tokeniseMarkdown(input)).toEqual(expected);
});
