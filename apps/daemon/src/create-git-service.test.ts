import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test } from 'vitest';

import { createGitService } from './create-git-service.ts';
import { DaemonError } from './daemon-error.ts';

// Real git in a temp directory (engineering.md § Testing).

// Drop GIT_* from the environment: under the pre-commit hook they point at the flux repo.
const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
);

const sh = (cwd: string, args: string[]): string =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...baseEnv,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 't@example.com',
      GIT_AUTHOR_DATE: '2026-08-29T10:00:00Z',
      GIT_COMMITTER_DATE: '2026-08-29T10:00:00Z',
    },
  });

let root: string;
let repo: string;
const git = createGitService();

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'flux-git-'));
  repo = join(root, 'app');
  await mkdir(repo);
  sh(repo, ['init', '-q', '-b', 'main']);
  await writeFile(join(repo, 'a.txt'), 'one\n');
  await writeFile(join(repo, 'bin.dat'), Buffer.from([0, 1, 2, 3]));
  sh(repo, ['add', '-A']);
  sh(repo, ['commit', '-q', '-m', 'init']);
});

test('status reports added, modified, deleted, renamed and untracked files', async () => {
  await writeFile(join(repo, 'a.txt'), 'two\n');
  await writeFile(join(repo, 'new.txt'), 'n\n');
  await writeFile(join(repo, 'untracked.txt'), 'u\n');
  sh(repo, ['add', 'new.txt']);
  sh(repo, ['mv', 'bin.dat', 'moved.dat']);
  const files = await git.status(repo);
  expect(files).toEqual(
    expect.arrayContaining([
      { path: 'a.txt', status: 'M' },
      { path: 'new.txt', status: 'A' },
      { path: 'untracked.txt', status: '?' },
      { path: 'moved.dat', status: 'R', from: 'bin.dat' },
    ]),
  );
  sh(repo, ['rm', '-qf', 'a.txt']);
  expect(await git.status(repo)).toEqual(expect.arrayContaining([{ path: 'a.txt', status: 'D' }]));
});

test('diff defaults to base against the worktree and accepts revs and a path', async () => {
  const base = await git.revParse(repo, 'HEAD');
  await writeFile(join(repo, 'a.txt'), 'two\n');
  const working = await git.diff(repo, base, {});
  expect(working).toContain('-one');
  expect(working).toContain('+two');
  sh(repo, ['commit', '-qam', 'second']);
  expect(await git.diff(repo, base, { to: 'worktree', path: 'a.txt' })).toContain('+two');
  expect(await git.diff(repo, base, { from: 'HEAD', to: 'HEAD' })).toBe('');
  expect(await git.diff(repo, base, { path: 'nope.txt' })).toBe('');
});

test('show reads a rev or the worktree, and flags binary content', async () => {
  await writeFile(join(repo, 'a.txt'), 'two\n');
  expect(await git.show(repo, 'a.txt', 'HEAD')).toEqual({ content: 'one\n', binary: false });
  expect(await git.show(repo, 'a.txt', 'worktree')).toEqual({ content: 'two\n', binary: false });
  expect(await git.show(repo, 'bin.dat', 'worktree')).toEqual({
    content: 'AAECAw==',
    binary: true,
  });
  await expect(git.show(repo, 'missing.txt', 'worktree')).rejects.toMatchObject({
    code: 'not_found',
  });
  await expect(git.show(repo, 'missing.txt', 'HEAD')).rejects.toMatchObject({ code: 'git_error' });
});

test('log lists commits newest first with author and time', async () => {
  await writeFile(join(repo, 'a.txt'), 'two\n');
  sh(repo, ['commit', '-qam', 'second']);
  const commits = await git.log(repo, 10);
  expect(commits).toHaveLength(2);
  expect(commits[0]).toMatchObject({
    subject: 'second',
    author: 'Test',
    ts: '2026-08-29T10:00:00Z',
  });
  expect(commits[0]?.sha).toMatch(/^[0-9a-f]{40}$/u);
  expect(await git.log(repo, 1)).toHaveLength(1);
});

test('branches and worktrees', async () => {
  sh(repo, ['branch', 'feature']);
  expect(await git.branches(repo)).toEqual(['feature', 'main']);
  const path = join(root, 'wt');
  await git.addWorktree(repo, path, 'flux/task', 'main');
  expect(await git.branches(repo)).toContain('flux/task');
  expect(await git.show(path, 'a.txt', 'worktree')).toEqual({ content: 'one\n', binary: false });
  await git.removeWorktree(repo, path);
  await expect(git.show(path, 'a.txt', 'worktree')).rejects.toThrow(DaemonError);
  await expect(git.addWorktree(repo, path, 'main', 'main')).rejects.toMatchObject({
    code: 'git_error',
  });
  await git.addWorktree(repo, path, 'feature', null);
  expect(await git.show(path, 'a.txt', 'worktree')).toEqual({ content: 'one\n', binary: false });
});

test('listRepos finds git repositories directly under a root, with their branches', async () => {
  await mkdir(join(root, 'not-a-repo'));
  await writeFile(join(root, 'file.txt'), 'x');
  sh(repo, ['branch', 'other']);
  expect(await git.listRepos(root)).toEqual([
    { path: repo, name: 'app', branches: ['main', 'other'] },
  ]);
});
