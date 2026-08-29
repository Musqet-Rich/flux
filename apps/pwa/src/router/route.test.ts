import { expect, test } from 'vitest';

import type { Route } from './route.ts';
import { route } from './route.ts';

const cases: [string, string, Route][] = [
  ['/', '', { name: 'sessions' }],
  ['/new', '', { name: 'new' }],
  ['/settings', '', { name: 'settings' }],
  ['/s/abc', '', { name: 'session', session: 'abc' }],
  ['/s/abc/changes', '', { name: 'changes', session: 'abc' }],
  ['/s/a%2Fb/diff', '?path=src%2Fx.ts', { name: 'diff', session: 'a/b', path: 'src/x.ts' }],
  [
    '/s/abc/diff',
    '?path=new.ts&from=old.ts',
    { name: 'diff', session: 'abc', path: 'new.ts', from: 'old.ts' },
  ],
  ['/s/abc/edit', '?path=src%2Fx.ts', { name: 'edit', session: 'abc', path: 'src/x.ts' }],
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
  expect(route.parse('/settings/devices')).toEqual({ name: 'sessions' });
  expect(route.parse('/s/')).toEqual({ name: 'sessions' });
  expect(route.parse('/s/abc/diff')).toEqual({ name: 'session', session: 'abc' });
  expect(route.parse('/s/abc/edit')).toEqual({ name: 'session', session: 'abc' });
  expect(route.parse('/s/abc/edit', '?path=a&from=b')).toEqual({
    name: 'edit',
    session: 'abc',
    path: 'a',
  });
  expect(route.parse('/s/abc/other/deeper')).toEqual({ name: 'session', session: 'abc' });
});
