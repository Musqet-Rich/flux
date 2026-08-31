import { expect, test } from 'vitest';

import type { Route } from './route.ts';
import { route } from './route.ts';

const cases: [string, string, Route][] = [
  ['/', '', { name: 'sessions' }],
  ['/new', '', { name: 'new' }],
  ['/settings', '', { name: 'settings' }],
  ['/runner', '', { name: 'runner' }],
  ['/s/abc', '', { name: 'session', session: 'abc' }],
  ['/s/abc/changes', '', { name: 'changes', session: 'abc' }],
  ['/s/a%2Fb/diff', '?path=src%2Fx.ts', { name: 'diff', session: 'a/b', path: 'src/x.ts' }],
  [
    '/s/abc/diff',
    '?path=new.ts&from=old.ts',
    { name: 'diff', session: 'abc', path: 'new.ts', from: 'old.ts' },
  ],
  ['/s/abc/edit', '?path=src%2Fx.ts', { name: 'edit', session: 'abc', path: 'src/x.ts' }],
  ['/s/abc/files', '', { name: 'files', session: 'abc', path: '' }],
  ['/s/abc/files', '?path=src%2Fsub', { name: 'files', session: 'abc', path: 'src/sub' }],
  [
    '/s/abc/edit',
    '?path=src%2Fx.ts&dir=src',
    { name: 'edit', session: 'abc', path: 'src/x.ts', dir: 'src' },
  ],
  // Opened from the browser at the worktree root: `dir` is the empty string, distinct from absent.
  ['/s/abc/edit', '?path=x.ts&dir=', { name: 'edit', session: 'abc', path: 'x.ts', dir: '' }],
];

test('paths round-trip through parse and path', () => {
  for (const [pathname, search, expected] of cases) {
    expect(route.parse(pathname, search)).toEqual(expected);
    expect(route.path(expected)).toBe(`${pathname}${search}`);
  }
});

// A filename may hold any of the characters that are special in a URL. `path` percent-encodes
// them (space as `+`, `#`/`?`/`%`/`/` and non-ASCII as `%xx`), so none leak into the query
// separator or the reserved fragment, and `parse` recovers the exact name.
test('filenames with URL-special or unicode characters survive path then parse', () => {
  const names = ['a b.ts', 'π.ts', 'a#b.ts', 'q?y.ts', '100%done.md', 'a&b=c.ts', 'n/deep'];
  for (const name of names) {
    for (const r of [
      { name: 'files', session: 'abc', path: `src/${name}` },
      { name: 'edit', session: 'abc', path: `src/${name}`, dir: `d/${name}` },
    ] satisfies Route[]) {
      const url = route.path(r); // path is non-empty, so a query is always present.
      const q = url.indexOf('?');
      const [pathname, search] = [url.slice(0, q), url.slice(q)];
      expect(search).not.toContain('#');
      expect(route.parse(pathname, search)).toEqual(r);
    }
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
