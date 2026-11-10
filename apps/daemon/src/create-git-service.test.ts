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

test('head names the branch, and a detached HEAD by its short sha', async () => {
  expect(await git.head(repo)).toBe('main');
  sh(repo, ['switch', '-q', '-c', 'feat/x']);
  expect(await git.head(repo)).toBe('feat/x');
  sh(repo, ['switch', '-q', '--detach']);
  expect(await git.head(repo)).toBe(sh(repo, ['rev-parse', '--short', 'HEAD']).trim());
  await expect(git.head(join(root, 'nowhere'))).rejects.toMatchObject({ code: 'git_error' });
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

const commit = async (cwd: string, file: string, subject: string): Promise<string> => {
  await writeFile(join(cwd, file), `${subject}\n`);
  sh(cwd, ['add', file]);
  sh(cwd, ['commit', '-q', '-m', subject]);
  return sh(cwd, ['rev-parse', 'HEAD']).trim();
};

// A bare `origin` holding main; `origin/HEAD` set as a clone has it unless `remoteAdded`.
const withOrigin = (remoteAdded = false): void => {
  const origin = join(root, 'origin.git');
  sh(root, ['init', '-q', '--bare', origin]);
  sh(repo, ['remote', 'add', 'origin', origin]);
  sh(repo, ['push', '-q', 'origin', 'main']);
  if (!remoteAdded) sh(repo, ['remote', 'set-head', 'origin', 'main']);
};

const session = async (): Promise<string> => {
  const path = join(root, 'wt');
  await git.addWorktree(repo, path, 'flux/task', 'main');
  return path;
};

test('unpushed lists the commits a deleted branch alone holds, newest first', async () => {
  withOrigin();
  const path = await session();
  expect(await git.unpushed(path, 'flux/task')).toEqual({ detached: false, commits: [] });
  const one = await commit(path, 'b.txt', 'one');
  const two = await commit(path, 'c.txt', 'two');
  expect(await git.unpushed(path, 'flux/task')).toEqual({
    detached: false,
    commits: [
      { sha: two, subject: 'two', possiblyMerged: false },
      { sha: one, subject: 'one', possiblyMerged: false },
    ],
  });
  sh(path, ['push', '-q', 'origin', 'flux/task~1:refs/heads/partial']);
  expect((await git.unpushed(path, 'flux/task')).commits.map((c) => c.sha)).toEqual([two]);
});

// Removing the worktree alone leaves the branch, and every commit on it, in the repository.
test('a branch the delete keeps holds its commits', async () => {
  withOrigin();
  const path = await session();
  await commit(path, 'b.txt', 'kept');
  expect(await git.unpushed(path, null)).toEqual({ detached: false, commits: [] });
});

// A session opened on an existing branch has that branch's tip as its base, so the base cannot
// stand in for what is safe: the branch's own local commits are what the delete would lose.
test('a session on an existing branch counts the local commits the branch had', async () => {
  withOrigin();
  sh(repo, ['branch', 'feature']);
  sh(repo, ['push', '-q', '-u', 'origin', 'feature']);
  sh(repo, ['switch', '-q', 'feature']);
  const local = await commit(repo, 'f.txt', 'local only');
  sh(repo, ['switch', '-q', 'main']);
  const path = join(root, 'wt');
  await git.addWorktree(repo, path, 'feature', null);
  expect(await git.unpushed(path, 'feature')).toEqual({
    detached: false,
    commits: [{ sha: local, subject: 'local only', possiblyMerged: false }],
  });
});

// The 2026-11-10 report: the agent built from `git switch --detach origin/dev`, and the
// commits dev had gained since were counted as the worktree's.
test('a detached HEAD ahead of the session branch on the remote has nothing unpushed', async () => {
  withOrigin();
  const path = await session();
  await commit(repo, 'd.txt', 'someone else');
  await commit(repo, 'e.txt', 'and again');
  sh(repo, ['push', '-q', 'origin', 'main']);
  sh(path, ['switch', '-q', '--detach', 'origin/main']);
  expect(await git.unpushed(path, 'flux/task')).toEqual({ detached: true, commits: [] });
});

test('a detached HEAD is evaluated on its own unless its branch is being deleted', async () => {
  withOrigin();
  const path = await session();
  const onBranch = await commit(path, 'b.txt', 'on the branch');
  sh(path, ['switch', '-q', '--detach', 'main']);
  const detached = await commit(path, 'c.txt', 'detached');
  expect(await git.unpushed(path, null)).toEqual({
    detached: true,
    commits: [{ sha: detached, subject: 'detached', possiblyMerged: false }],
  });
  expect((await git.unpushed(path, 'flux/task')).commits.map((c) => c.sha).toSorted()).toEqual(
    [detached, onBranch].toSorted(),
  );
});

test('commits pushed under another branch name are not unpushed', async () => {
  withOrigin();
  const path = await session();
  await commit(path, 'b.txt', 'one');
  sh(path, ['push', '-q', 'origin', 'flux/task:refs/heads/fix/elsewhere']);
  expect(await git.unpushed(path, 'flux/task')).toEqual({ detached: false, commits: [] });
});

// A squash merge leaves the branch's commits on no remote; one whose patch the default branch
// holds is flagged, but as possibly merged, so the operator can judge.
test('a commit whose patch is on the remote default branch is possibly merged', async () => {
  withOrigin();
  const path = await session();
  const merged = await commit(path, 'b.txt', 'squashed upstream');
  const local = await commit(path, 'c.txt', 'only here');
  await commit(repo, 'd.txt', 'main moved on');
  sh(repo, ['cherry-pick', merged]);
  sh(repo, ['push', '-q', 'origin', 'main']);
  expect(await git.unpushed(path, 'flux/task')).toEqual({
    detached: false,
    commits: [
      { sha: local, subject: 'only here', possiblyMerged: false },
      { sha: merged, subject: 'squashed upstream', possiblyMerged: true },
    ],
  });
});

// `git remote add` sets no `origin/HEAD`: `origin/main` stands in, and the upstream counts too.
test('without a remote HEAD, main and the upstream are where a patch is looked for', async () => {
  withOrigin(true);
  const path = await session();
  const onMain = await commit(path, 'b.txt', 'picked to main');
  const onUpstream = await commit(path, 'c.txt', 'picked to the upstream');
  await commit(repo, 'd.txt', 'main moved on');
  sh(repo, ['cherry-pick', onMain]);
  sh(repo, ['push', '-q', 'origin', 'main']);
  sh(repo, ['branch', 'review', 'main~1']);
  sh(repo, ['switch', '-q', 'review']);
  sh(repo, ['cherry-pick', onUpstream]);
  sh(repo, ['switch', '-q', 'main']);
  sh(repo, ['push', '-q', 'origin', 'review']);
  sh(repo, ['branch', '-q', '-D', 'review']);
  sh(path, ['branch', '-q', '--set-upstream-to=origin/review']);
  const { commits } = await git.unpushed(path, 'flux/task');
  expect(commits.map((c) => [c.subject, c.possiblyMerged])).toEqual([
    ['picked to the upstream', true],
    ['picked to main', true],
  ]);
});

// A fork: `origin` was cloned and has a HEAD, `upstream` was added and has none.
test('a remote without a HEAD is searched on its main even when another has one', async () => {
  withOrigin();
  const upstream = join(root, 'upstream.git');
  sh(root, ['init', '-q', '--bare', upstream]);
  sh(repo, ['remote', 'add', 'upstream', upstream]);
  const path = await session();
  const picked = await commit(path, 'b.txt', 'squashed into upstream');
  await commit(repo, 'd.txt', 'upstream moved on');
  sh(repo, ['cherry-pick', picked]);
  sh(repo, ['push', '-q', 'upstream', 'main']);
  sh(repo, ['reset', '-q', '--hard', 'origin/main']);
  expect(await git.unpushed(path, 'flux/task')).toEqual({
    detached: false,
    commits: [{ sha: picked, subject: 'squashed into upstream', possiblyMerged: true }],
  });
});

test('without any remote, the commits no other branch holds are what is unpushed', async () => {
  const path = await session();
  const one = await commit(path, 'b.txt', 'one');
  expect(await git.unpushed(path, 'flux/task')).toEqual({
    detached: false,
    commits: [{ sha: one, subject: 'one', possiblyMerged: false }],
  });
});

// Revisions end at `--`, so a file named like one is not an ambiguous argument.
test('a file named HEAD in the worktree does not break the check', async () => {
  const path = await session();
  await writeFile(join(path, 'HEAD'), 'x\n');
  expect((await git.unpushed(path, 'flux/task')).commits).toEqual([]);
});

test('a branch that is already gone is not an error', async () => {
  const path = await session();
  sh(path, ['switch', '-q', '--detach']);
  sh(repo, ['branch', '-q', '-D', 'flux/task']);
  expect(await git.unpushed(path, 'flux/task')).toEqual({ detached: true, commits: [] });
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
