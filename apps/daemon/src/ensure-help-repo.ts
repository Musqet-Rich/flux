import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { GitActions } from './git-actions.ts';

// The daemon's throwaway help repo (ADR 0008): a git repository under the data dir that a Help
// session (`sessions.createHelp`) branches a worktree from, so a pure Q&A session never cuts a
// worktree in a user repo under `reposDir`. Idempotent — a directory that already holds a `.git`
// is reused untouched; a fresh one is `git init`ed with an empty initial commit so `HEAD` exists.
// Never touches `reposDir`.

type HelpRepoGit = Pick<GitActions, 'init' | 'emptyCommit'>;

const isRepo = async (path: string): Promise<boolean> =>
  (await stat(join(path, '.git')).catch(() => null)) !== null;

export const ensureHelpRepo = async (dataDir: string, git: HelpRepoGit): Promise<string> => {
  const path = join(dataDir, 'help');
  if (await isRepo(path)) return path;
  await mkdir(path, { recursive: true });
  await git.init(path);
  await git.emptyCommit(path, 'flux help repo');
  return path;
};
