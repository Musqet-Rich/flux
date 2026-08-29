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

// `pr view` succeeds only when the marker file exists (it holds gh's JSON answer); `pr create`
// prints the new PR's URL. Every call logs its arguments NUL-separated, one call per record
// separator, so a wrongly split or joined argument shows up.
const fakeGh = `#!/bin/sh
printf '%s\\0' "$@" >> "$FLUX_FAKE_GH_LOG"
printf '\\036' >> "$FLUX_FAKE_GH_LOG"
case "$1 $2" in
  "pr view") [ -f "$FLUX_FAKE_GH_EXISTING" ] && { cat "$FLUX_FAKE_GH_EXISTING"; exit 0; }
             echo "no pull requests found for branch" >&2; exit 1 ;;
  "pr create") echo "https://github.com/o/r/pull/8"; exit 0 ;;
esac
exit 2
`;

const view = ['pr', 'view', '--json', 'url,state'];

let root: string;
let repo: string;
let remote: string;
let env: NodeJS.ProcessEnv;
let git: ReturnType<typeof createGitService>;

const ghCalls = async (): Promise<string[][]> =>
  (await readFile(join(root, 'gh.log'), 'utf8'))
    .split('')
    .filter((record) => record !== '')
    .map((record) => record.split('\0').slice(0, -1));

const committedFiles = (): string[] =>
  sh(repo, ['show', '--name-only', '--format=', '-z', 'HEAD'])
    .split('\0')
    .filter((f) => f !== '');

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
  expect(committedFiles()).toEqual(['b.txt']);
  expect(await git.status(repo)).toEqual([
    { path: 'a.txt', status: 'M' },
    { path: 'c.txt', status: '?' },
  ]);
  const all = await git.commit(repo, 'the rest');
  expect(all).not.toBe(sha);
  expect(await git.status(repo)).toEqual([]);
  expect((await git.log(repo, 3)).map((c) => c.subject)).toEqual(['the rest', 'add b', 'init']);
});

test('commit of chosen paths leaves what the agent had staged elsewhere staged', async () => {
  await writeFile(join(repo, 'staged.txt'), 's\n');
  sh(repo, ['add', 'staged.txt']);
  await writeFile(join(repo, 'a.txt'), 'two\n');
  await git.commit(repo, 'a only', ['a.txt']);
  expect(committedFiles()).toEqual(['a.txt']);
  expect(await git.status(repo)).toEqual([{ path: 'staged.txt', status: 'A' }]);
});

test('commit accepts paths with spaces, newlines and a leading dash', async () => {
  const odd = ['with space.txt', 'new\nline.txt', '-dash.txt'];
  await Promise.all(odd.map((name) => writeFile(join(repo, name), 'x\n')));
  await writeFile(join(repo, 'other.txt'), 'o\n');
  await git.commit(repo, 'odd', odd);
  expect(committedFiles().toSorted()).toEqual(odd.toSorted());
  expect(await git.status(repo)).toEqual([{ path: 'other.txt', status: '?' }]);
});

test('a rename commits by both paths; by the new path alone the deletion stays staged', async () => {
  sh(repo, ['mv', 'a.txt', 'b.txt']);
  await git.commit(repo, 'renamed', ['b.txt']);
  expect(await git.status(repo)).toEqual([{ path: 'a.txt', status: 'D' }]);
  sh(repo, ['reset', '-q', '--hard', 'HEAD~1']);
  sh(repo, ['mv', 'a.txt', 'b.txt']);
  await git.commit(repo, 'renamed', ['b.txt', 'a.txt']);
  expect(await git.status(repo)).toEqual([]);
  expect(committedFiles()).toEqual(['b.txt']);
});

test('commit refuses an empty message, no paths, a path outside the worktree, and the worktree itself', async () => {
  await expect(git.commit(repo, '  ')).rejects.toMatchObject({ code: 'bad_params' });
  await expect(git.commit(repo, 'm', [])).rejects.toMatchObject({ code: 'bad_params' });
  await expect(git.commit(repo, 'm', ['../outside'])).rejects.toMatchObject({
    code: 'bad_params',
  });
  await expect(git.commit(repo, 'm', ['a.txt', ''])).rejects.toMatchObject({ code: 'bad_params' });
  await expect(git.commit(repo, 'm', ['.'])).rejects.toMatchObject({ code: 'bad_params' });
  await expect(git.commit(repo, 'm', ['./'])).rejects.toMatchObject({ code: 'bad_params' });
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

test('a repository-selecting variable in the environment is ignored; the cwd decides', async () => {
  const elsewhere = createGitService({ env: { ...env, GIT_DIR: remote } });
  expect(await elsewhere.status(repo)).toEqual([]);
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

test('push never forces: a diverged remote rejects it with git stderr', async () => {
  await git.push(repo, false);
  const other = join(root, 'other');
  sh(root, ['clone', '-q', remote, other]);
  sh(other, ['config', 'user.name', 'Other']);
  sh(other, ['config', 'user.email', 'o@example.com']);
  await writeFile(join(other, 'theirs.txt'), 't\n');
  sh(other, ['add', '-A']);
  sh(other, ['commit', '-q', '-m', 'theirs']);
  sh(other, ['push', '-q']);
  await writeFile(join(repo, 'a.txt'), 'two\n');
  await git.commit(repo, 'mine');
  await expect(git.push(repo, false)).rejects.toMatchObject({
    code: 'git_error',
    message: expect.stringMatching(/rejected|fetch first/u),
  });
  expect(sh(repo, ['rev-parse', 'HEAD'])).not.toBe(sh(remote, ['rev-parse', 'main']));
});

test('push without a remote, or off a branch, is a git_error that says which', async () => {
  sh(repo, ['checkout', '-q', '--detach']);
  await expect(git.push(repo, false)).rejects.toMatchObject({
    code: 'git_error',
    message: 'not on a branch (detached HEAD)',
  });
  sh(repo, ['checkout', '-q', 'main']);
  sh(repo, ['remote', 'remove', 'origin']);
  await expect(git.push(repo, false)).rejects.toMatchObject({ code: 'git_error' });
});

test('pr creates a pull request with gh, passing each option as its own argument', async () => {
  const title = '-Title with spaces';
  const body = 'First line\n\nsecond --paragraph';
  const url = await git.pr(repo, { title, body, base: 'main', draft: true });
  expect(url).toBe('https://github.com/o/r/pull/8');
  expect(await ghCalls()).toEqual([
    view,
    ['pr', 'create', '--title', title, '--body', body, '--base', 'main', '--draft'],
  ]);
});

test('pr without a body or base passes an empty body so gh never opens an editor', async () => {
  await git.pr(repo, { title: 'T' });
  expect(await ghCalls()).toEqual([view, ['pr', 'create', '--title', 'T', '--body', '']]);
});

test('pr returns the open pull request instead of creating another', async () => {
  await writeFile(
    join(root, 'existing-pr'),
    '{"url":"https://github.com/o/r/pull/3","state":"OPEN"}',
  );
  expect(await git.pr(repo, { title: 'T' })).toBe('https://github.com/o/r/pull/3');
  expect(await ghCalls()).toEqual([view]);
});

test('pr creates a new pull request when the branch only has a closed or merged one', async () => {
  await writeFile(
    join(root, 'existing-pr'),
    '{"url":"https://github.com/o/r/pull/3","state":"MERGED"}',
  );
  expect(await git.pr(repo, { title: 'T' })).toBe('https://github.com/o/r/pull/8');
  await writeFile(
    join(root, 'existing-pr'),
    '{"url":"https://github.com/o/r/pull/3","state":"CLOSED"}',
  );
  expect(await git.pr(repo, { title: 'T' })).toBe('https://github.com/o/r/pull/8');
  expect((await ghCalls()).map((call) => call[1])).toEqual(['view', 'create', 'view', 'create']);
});

test('pr falls through to create when gh pr view prints something unusable', async () => {
  await writeFile(join(root, 'existing-pr'), 'not json');
  expect(await git.pr(repo, { title: 'T' })).toBe('https://github.com/o/r/pull/8');
  await writeFile(join(root, 'existing-pr'), '{"url":7,"state":"OPEN"}');
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
