import { expect, test } from 'vitest';

import type { Route } from './route.ts';
import { route } from './route.ts';

const cases: [string, string, Route][] = [
  ['/', '', { name: 'sessions' }],
  ['/new', '', { name: 'new' }],
  ['/s/abc', '', { name: 'session', session: 'abc' }],
  ['/s/abc/changes', '', { name: 'changes', session: 'abc' }],
  ['/s/a%2Fb/diff', '?path=src%2Fx.ts', { name: 'diff', session: 'a/b', path: 'src/x.ts' }],
];

test('paths round-trip through parse and path', () => {
  for (const [pathname, search, expected] of cases) {
    expect(route.parse(pathname, search)).toEqual(expected);
    expect(route.path(expected)).toBe(`${pathname}${search}`);
  }
});

test('anything unrecognised falls back to the nearest screen', () => {
  expect(route.parse('/nope')).toEqual({ name: 'sessions' });
  expect(route.parse('/new/extra')).toEqual({ name: 'sessions' });
  expect(route.parse('/s/')).toEqual({ name: 'sessions' });
  expect(route.parse('/s/abc/diff')).toEqual({ name: 'session', session: 'abc' });
  expect(route.parse('/s/abc/other/deeper')).toEqual({ name: 'session', session: 'abc' });
});
