import { expect, test } from 'vitest';

import { skillName } from './skill-name.ts';

test('accepts a plain single path segment', () => {
  for (const name of ['review', 'my-skill', 'skill_1', 'a.b', 'Café', '..foo', 'foo..']) {
    expect(skillName.is(name)).toBe(true);
  }
});

test('rejects empty, traversal, separators, absolute paths and control characters', () => {
  const bad: unknown[] = [
    '',
    '.',
    '..',
    'a/b',
    '../evil',
    './x',
    '/etc/passwd',
    'a\\b',
    'C:\\x',
    'x\ny',
    'x\ty',
    'x\u0000y',
    'x\u007F',
    42,
    null,
    undefined,
    {},
    ['review'],
  ];
  for (const name of bad) expect(skillName.is(name)).toBe(false);
});
