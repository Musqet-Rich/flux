import { expect, test } from 'vitest';

import { conventionalCommit } from './conventional-commit.ts';

const commit = (sha: string, subject: string) => ({ sha, subject, author: 'me', ts: 't' });

test('matches type, optional scope, breaking mark and a non-blank subject', () => {
  expect(conventionalCommit.matches('feat: add thing')).toBe(true);
  expect(conventionalCommit.matches('fix(pwa): keep title')).toBe(true);
  expect(conventionalCommit.matches('refactor(daemon)!: drop v0')).toBe(true);
  expect(conventionalCommit.matches('perf: faster')).toBe(true);
  expect(conventionalCommit.matches('style: spaces')).toBe(true);
  expect(conventionalCommit.matches('Test')).toBe(false);
  expect(conventionalCommit.matches('feat add thing')).toBe(false);
  expect(conventionalCommit.matches('feat:  double space')).toBe(false);
  expect(conventionalCommit.matches('feat: ')).toBe(false);
  expect(conventionalCommit.matches('wip: later')).toBe(false);
  expect(conventionalCommit.matches('feat(): empty scope')).toBe(false);
  expect(conventionalCommit.matches('feat(a b): spaced scope')).toBe(false);
  expect(conventionalCommit.matches(`feat: ${'x'.repeat(94)}`)).toBe(true);
  expect(conventionalCommit.matches(`feat: ${'x'.repeat(95)}`)).toBe(false);
});

test('latest prefers the newest conventional subject, else the newest commit', () => {
  const tidy = commit('2', 'feat(pwa): second');
  expect(conventionalCommit.latest([])).toBeNull();
  expect(conventionalCommit.latest([commit('1', 'wip')])).toEqual(commit('1', 'wip'));
  expect(conventionalCommit.latest([commit('3', 'wip'), tidy, commit('1', 'fix: first')])).toBe(
    tidy,
  );
  expect(conventionalCommit.latest([tidy, commit('1', 'fix: first')])).toBe(tidy);
});
