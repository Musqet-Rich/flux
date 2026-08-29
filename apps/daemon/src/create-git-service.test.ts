import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

test('show reads a rev or the worktree, hashes the bytes, and flags binary content', async () => {
  await writeFile(join(repo, 'a.txt'), 'two\n');
  expect(await git.show(repo, 'a.txt', 'HEAD')).toEqual({
    content: 'one\n',
    binary: false,
    hash: sha256('one\n'),
    truncated: false,
  });
  expect(await git.show(repo, 'a.txt', 'worktree')).toMatchObject({
    content: 'two\n',
    binary: false,
    hash: sha256('two\n'),
  });
  expect(await git.show(repo, 'bin.dat', 'worktree')).toMatchObject({
    content: 'AAECAw==',
    binary: true,
  });
  expect(await git.show(repo, 'bin.dat', 'HEAD')).toMatchObject({
    content: 'AAECAw==',
    binary: true,
  });
  await expect(git.show(repo, 'missing.txt', 'worktree')).rejects.toMatchObject({
    code: 'not_found',
  });
  await expect(git.show(repo, 'missing.txt', 'HEAD')).rejects.toMatchObject({ code: 'git_error' });
});

test('log lists the commits beyond the base newest first with author and time', async () => {
  const base = sh(repo, ['rev-parse', 'HEAD']).trim();
  expect(await git.log(repo, base, 10)).toEqual([]);
  await writeFile(join(repo, 'a.txt'), 'two\n');
  sh(repo, ['commit', '-qam', 'second']);
  await writeFile(join(repo, 'a.txt'), 'three\n');
  sh(repo, ['commit', '-qam', 'third']);
  const commits = await git.log(repo, base, 10);
  expect(commits.map((c) => c.subject)).toEqual(['third', 'second']);
  expect(commits[0]).toMatchObject({
    subject: 'third',
    author: 'Test',
    ts: '2026-08-29T10:00:00Z',
  });
  expect(commits[0]?.sha).toMatch(/^[0-9a-f]{40}$/u);
  expect(await git.log(repo, base, 1)).toHaveLength(1);
});

test('branches and worktrees', async () => {
  sh(repo, ['branch', 'feature']);
  expect(await git.branches(repo)).toEqual(['feature', 'main']);
  const path = join(root, 'wt');
  await git.addWorktree(repo, path, 'flux/task', 'main');
  expect(await git.branches(repo)).toContain('flux/task');
  expect(await git.show(path, 'a.txt', 'worktree')).toMatchObject({ content: 'one\n' });
  await writeFile(join(path, 'wip.txt'), 'w\n');
  await expect(git.removeWorktree(repo, path, false)).rejects.toMatchObject({ code: 'git_error' });
  await git.removeWorktree(repo, path, true);
  await expect(git.show(path, 'a.txt', 'worktree')).rejects.toThrow(DaemonError);
  await git.deleteBranch(repo, 'flux/task');
  expect(await git.branches(repo)).toEqual(['feature', 'main']);
  await expect(git.deleteBranch(repo, 'main')).rejects.toMatchObject({ code: 'git_error' });
  await expect(git.addWorktree(repo, path, 'main', 'main')).rejects.toMatchObject({
    code: 'git_error',
  });
  await git.addWorktree(repo, path, 'feature', null);
  expect(await git.show(path, 'a.txt', 'worktree')).toMatchObject({ content: 'one\n' });
});

// A worktree removed by hand leaves git thinking its branch is still checked out.
test('a branch of a worktree that is gone can be deleted once pruned', async () => {
  const path = join(root, 'wt');
  await git.addWorktree(repo, path, 'flux/gone', 'main');
  await rm(path, { recursive: true, force: true });
  await expect(git.deleteBranch(repo, 'flux/gone')).rejects.toMatchObject({ code: 'git_error' });
  await git.pruneWorktrees(repo);
  await git.deleteBranch(repo, 'flux/gone');
  expect(await git.branches(repo)).toEqual(['main']);
});

test('unpushed counts commits beyond the upstream, or beyond the base without one', async () => {
  const path = join(root, 'wt');
  await git.addWorktree(repo, path, 'flux/task', 'main');
  expect(await git.unpushed(path, 'main')).toBe(0);
  await writeFile(join(path, 'b.txt'), 'b\n');
  sh(path, ['add', 'b.txt']);
  sh(path, ['commit', '-q', '-m', 'one']);
  await writeFile(join(path, 'c.txt'), 'c\n');
  sh(path, ['add', 'c.txt']);
  sh(path, ['commit', '-q', '-m', 'two']);
  expect(await git.unpushed(path, 'main')).toBe(2);
  sh(repo, ['branch', 'tracker', 'flux/task~1']);
  sh(path, ['branch', '--set-upstream-to=tracker']);
  expect(await git.unpushed(path, 'main')).toBe(1);
});

test('show sends the first MiB of a large file, committed or not, and hashes all of it', async () => {
  const big = 'x'.repeat(1024 * 1024 + 5);
  await writeFile(join(repo, 'big.txt'), big);
  sh(repo, ['add', 'big.txt']);
  sh(repo, ['commit', '-qm', 'big']);
  const shown = await Promise.all([
    git.show(repo, 'big.txt', 'worktree'),
    git.show(repo, 'big.txt', 'HEAD'),
  ]);
  expect(shown.map((s) => s.truncated)).toEqual([true, true]);
  expect(shown.map((s) => s.content.length)).toEqual([1024 * 1024, 1024 * 1024]);
  expect(shown.map((s) => s.hash)).toEqual([sha256(big), sha256(big)]);
});

test('show treats bytes that are not UTF-8 as binary, so they cannot be edited lossily', async () => {
  const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9]);
  await writeFile(join(repo, 'latin.txt'), latin1);
  const shown = await git.show(repo, 'latin.txt', 'worktree');
  expect(shown.binary).toBe(true);
  expect(shown.content).toBe(latin1.toString('base64'));
});

test('a missing repositories root is not_found, not an errno', async () => {
  await expect(createGitService().listRepos('/nowhere/at/all')).rejects.toThrow(
    'missing or unreadable',
  );
});

test('listRepos finds git repositories directly under a root, with their branches', async () => {
  await mkdir(join(root, 'not-a-repo'));
  await writeFile(join(root, 'file.txt'), 'x');
  sh(repo, ['branch', 'other']);
  expect(await git.listRepos(root)).toEqual([
    { path: repo, name: 'app', branches: ['main', 'other'] },
  ]);
});
