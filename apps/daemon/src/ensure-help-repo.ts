import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { GitActions } from './git-actions.ts';

// The daemon's throwaway help repo (ADR 0008): a git repository under the data dir that a Help
// session (`sessions.createHelp`) branches a worktree from, so a pure Q&A session never cuts a
// worktree in a user repo under `reposDir`. Idempotent — a directory that already holds a `.git`
// is reused untouched; a fresh one is `git init`ed with an empty initial commit so `HEAD` exists.
// Concurrent calls share one build, so it is init'd and committed exactly once. Never touches
// `reposDir`.

type HelpRepoGit = Pick<GitActions, 'init' | 'emptyCommit'>;

const isRepo = async (path: string): Promise<boolean> =>
  (await stat(join(path, '.git')).catch(() => null)) !== null;

const build = async (dataDir: string, git: HelpRepoGit): Promise<string> => {
  const path = join(dataDir, 'help');
  if (await isRepo(path)) return path;
  await mkdir(path, { recursive: true });
  await git.init(path);
  await git.emptyCommit(path, 'flux help repo');
  return path;
};

// Two createHelp calls arriving together on a fresh box both pass the `isRepo` check before either
// commits, so without this they would double-init and race on git's `index.lock`. One build runs
// per data dir at a time (the `file-content.ts` chain idiom); concurrent callers share its promise
// and its single empty commit. The entry is forgotten once settled, so a later call re-checks disk.
const inFlight = new Map<string, Promise<string>>();

export const ensureHelpRepo = (dataDir: string, git: HelpRepoGit): Promise<string> => {
  const running = inFlight.get(dataDir);
  if (running !== undefined) return running;
  const run = build(dataDir, git);
  const forget = (): void => {
    if (inFlight.get(dataDir) === run) inFlight.delete(dataDir);
  };
  inFlight.set(dataDir, run);
  void run.then(forget, forget);
  return run;
};
