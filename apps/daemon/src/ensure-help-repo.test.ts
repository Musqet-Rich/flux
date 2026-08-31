import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test } from 'vitest';

import { createGitService } from './create-git-service.ts';
import { ensureHelpRepo } from './ensure-help-repo.ts';

// The daemon's managed help repo (ADR 0008): real git against a temp data dir. It must live under
// the data dir (never `reposDir`), have a HEAD so a worktree can be branched, and be idempotent.

const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
);

const sh = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: baseEnv }).trim();

let dataDir: string;
let git: ReturnType<typeof createGitService>;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'flux-help-repo-'));
  git = createGitService({ env: baseEnv });
});

test('creates a git repo under the data dir with an initial commit, and addWorktree succeeds', async () => {
  const path = await ensureHelpRepo(dataDir, git);
  expect(path).toBe(join(dataDir, 'help'));
  const head = sh(path, ['rev-parse', 'HEAD']);
  expect(head).toMatch(/^[0-9a-f]{40}$/u);
  await git.addWorktree(path, join(dataDir, 'wt'), 'help-abc123', head);
  expect(sh(join(dataDir, 'wt'), ['rev-parse', 'HEAD'])).toBe(head);
});

test('is idempotent: a second call reuses the repo without re-initialising it', async () => {
  const first = await ensureHelpRepo(dataDir, git);
  const head = sh(first, ['rev-parse', 'HEAD']);
  // Record a fact only a fresh init/commit would erase or change.
  sh(first, ['config', 'flux.marker', 'kept']);
  const second = await ensureHelpRepo(dataDir, git);
  expect(second).toBe(first);
  expect(sh(second, ['rev-parse', 'HEAD'])).toBe(head);
  expect(sh(second, ['config', 'flux.marker'])).toBe('kept');
});

test('reuses an existing repo even when init/emptyCommit would throw', async () => {
  await ensureHelpRepo(dataDir, git);
  const guard = {
    init: () => Promise.reject(new Error('must not init again')),
    emptyCommit: () => Promise.reject(new Error('must not commit again')),
  };
  await expect(ensureHelpRepo(dataDir, guard)).resolves.toBe(join(dataDir, 'help'));
});

test('concurrent calls on a fresh box build the repo once, never a double-init', async () => {
  let inits = 0;
  let commits = 0;
  const spy = {
    init: async (repo: string): Promise<void> => {
      inits += 1;
      await mkdir(join(repo, '.git'), { recursive: true });
    },
    emptyCommit: (): Promise<void> => {
      commits += 1;
      return Promise.resolve();
    },
  };
  const [a, b] = await Promise.all([ensureHelpRepo(dataDir, spy), ensureHelpRepo(dataDir, spy)]);
  expect(a).toBe(join(dataDir, 'help'));
  expect(b).toBe(a);
  expect(inits).toBe(1);
  expect(commits).toBe(1);
});
