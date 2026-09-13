import { expect, test } from 'vitest';

import { homePath } from './home-path.ts';

test('folds the home directory to ~ and leaves other paths whole', () => {
  expect(homePath('/Users/rich/code/flux', '/Users/rich')).toBe('~/code/flux');
  expect(homePath('/Users/rich', '/Users/rich')).toBe('~');
  expect(homePath('/Users/rich/code/flux', '/Users/rich/')).toBe('~/code/flux');
  expect(homePath('/Users/richard/code', '/Users/rich')).toBe('/Users/richard/code');
  expect(homePath('/srv/repos/app', '/home/flux')).toBe('/srv/repos/app');
  expect(homePath('/home/flux/repos/app', null)).toBe('/home/flux/repos/app');
  expect(homePath('/home/flux/repos/app', '/')).toBe('/home/flux/repos/app');
});
