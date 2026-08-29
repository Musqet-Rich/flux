import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test } from 'vitest';

import { createGitService } from './create-git-service.ts';

// Real git against temp repositories with a local bare remote; `gh` is the process boundary, so
// it is a script placed first on PATH that logs its arguments (engineering.md § Testing).

const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
);

const sh = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: baseEnv }).trim();

// `pr view` succeeds only when the marker file exists (a PR is open for the branch); `pr create`
// prints the new PR's URL. Both append their arguments to the log file.
const fakeGh = `#!/bin/sh
printf '%s\\n' "$*" >> "$FLUX_FAKE_GH_LOG"
case "$1 $2" in
  "pr view") [ -f "$FLUX_FAKE_GH_EXISTING" ] && { cat "$FLUX_FAKE_GH_EXISTING"; exit 0; }
             echo "no pull requests found for branch" >&2; exit 1 ;;
  "pr create") echo "https://github.com/o/r/pull/8"; exit 0 ;;
esac
exit 2
`;

let root: string;
let repo: string;
let remote: string;
let env: NodeJS.ProcessEnv;
let git: ReturnType<typeof createGitService>;

const ghCalls = async (): Promise<string[]> =>
  (await readFile(join(root, 'gh.log'), 'utf8')).trim().split('\n');

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'flux-actions-'));
  repo = join(root, 'app');
  remote = join(root, 'remote.git');
  const bin = join(root, 'bin');
  await Promise.all([mkdir(repo), mkdir(remote), mkdir(bin), mkdir(join(root, 'home'))]);
  await writeFile(join(bin, 'gh'), fakeGh);
  await chmod(join(bin, 'gh'), 0o755);
  env = {
    ...baseEnv,
    PATH: `${bin}:${baseEnv['PATH'] ?? ''}`,
    HOME: join(root, 'home'),
    XDG_CONFIG_HOME: join(root, 'home'),
    FLUX_FAKE_GH_LOG: join(root, 'gh.log'),
    FLUX_FAKE_GH_EXISTING: join(root, 'existing-pr'),
  };
  git = createGitService({ env });
  sh(remote, ['init', '-q', '--bare', '-b', 'main']);
  sh(repo, ['init', '-q', '-b', 'main']);
  sh(repo, ['config', 'user.name', 'Test']);
  sh(repo, ['config', 'user.email', 't@example.com']);
  sh(repo, ['remote', 'add', 'origin', remote]);
  await writeFile(join(repo, 'a.txt'), 'one\n');
  sh(repo, ['add', '-A']);
  sh(repo, ['commit', '-q', '-m', 'init']);
});

test('commit stages the given paths only, or everything including untracked files', async () => {
  await writeFile(join(repo, 'a.txt'), 'two\n');
  await writeFile(join(repo, 'b.txt'), 'b\n');
  await writeFile(join(repo, 'c.txt'), 'c\n');
  const sha = await git.commit(repo, 'add b', ['b.txt']);
  expect(sha).toBe(sh(repo, ['rev-parse', 'HEAD']));
  expect(await git.status(repo)).toEqual([
    { path: 'a.txt', status: 'M' },
    { path: 'c.txt', status: '?' },
  ]);
  const all = await git.commit(repo, 'the rest');
  expect(all).not.toBe(sha);
  expect(await git.status(repo)).toEqual([]);
  expect((await git.log(repo, 3)).map((c) => c.subject)).toEqual(['the rest', 'add b', 'init']);
});

test('commit refuses an empty message, no paths, and a path outside the worktree', async () => {
  await expect(git.commit(repo, '  ')).rejects.toMatchObject({ code: 'bad_params' });
  await expect(git.commit(repo, 'm', [])).rejects.toMatchObject({ code: 'bad_params' });
  await expect(git.commit(repo, 'm', ['../outside'])).rejects.toMatchObject({
    code: 'bad_params',
  });
});

test('commit with nothing to commit is a git_error carrying git output', async () => {
  await expect(git.commit(repo, 'empty')).rejects.toMatchObject({
    code: 'git_error',
    message: expect.stringContaining('nothing to commit'),
  });
});

test('commit without an identity is a git_error carrying git stderr', async () => {
  sh(repo, ['config', '--unset', 'user.name']);
  sh(repo, ['config', '--unset', 'user.email']);
  sh(repo, ['config', 'user.useConfigOnly', 'true']);
  await writeFile(join(repo, 'a.txt'), 'two\n');
  await expect(git.commit(repo, 'who')).rejects.toMatchObject({
    code: 'git_error',
    message: expect.stringMatching(/identity|who you are/iu),
  });
});

test('push sets the upstream on the first push and pushes plainly after that', async () => {
  expect(await git.push(repo, false)).toEqual({ remote: 'origin', branch: 'main' });
  const first = sh(repo, ['rev-parse', 'HEAD']);
  expect(sh(remote, ['rev-parse', 'main'])).toBe(first);
  expect(sh(repo, ['rev-parse', '--abbrev-ref', 'main@{upstream}'])).toBe('origin/main');
  await writeFile(join(repo, 'a.txt'), 'two\n');
  const second = await git.commit(repo, 'second');
  expect(await git.push(repo, false)).toEqual({ remote: 'origin', branch: 'main' });
  expect(sh(remote, ['rev-parse', 'main'])).toBe(second);
});

test('push without a remote is a git_error', async () => {
  sh(repo, ['remote', 'remove', 'origin']);
  await expect(git.push(repo, false)).rejects.toMatchObject({ code: 'git_error' });
});

test('pr creates a pull request with gh and returns its URL', async () => {
  const url = await git.pr(repo, { title: 'Title', body: 'Body', base: 'main', draft: true });
  expect(url).toBe('https://github.com/o/r/pull/8');
  expect(await ghCalls()).toEqual([
    'pr view --json url',
    'pr create --title Title --body Body --base main --draft',
  ]);
});

test('pr returns the existing pull request instead of creating another', async () => {
  await writeFile(join(root, 'existing-pr'), '{"url":"https://github.com/o/r/pull/3"}');
  expect(await git.pr(repo, { title: 'T' })).toBe('https://github.com/o/r/pull/3');
  expect(await ghCalls()).toEqual(['pr view --json url']);
});

test('pr falls through to create when gh pr view prints something unusable', async () => {
  await writeFile(join(root, 'existing-pr'), 'not json');
  expect(await git.pr(repo, { title: 'T' })).toBe('https://github.com/o/r/pull/8');
  await writeFile(join(root, 'existing-pr'), '{"url":7}');
  expect(await git.pr(repo, { title: 'T' })).toBe('https://github.com/o/r/pull/8');
  expect(await ghCalls()).toHaveLength(4);
});

test('pr refuses an empty title', async () => {
  await expect(git.pr(repo, { title: ' ' })).rejects.toMatchObject({ code: 'bad_params' });
});

test('pr without gh on PATH is a gh_error that says so', async () => {
  // A PATH holding only git, so a gh installed on this machine cannot answer.
  const only = join(root, 'only-git');
  await mkdir(only);
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  await writeFile(join(only, 'git'), `#!/bin/sh\nexec "${realGit}" "$@"\n`);
  await chmod(join(only, 'git'), 0o755);
  const without = createGitService({ env: { ...env, PATH: only } });
  await expect(without.pr(repo, { title: 'T' })).rejects.toMatchObject({
    code: 'gh_error',
    message: 'gh not found on PATH',
  });
});
