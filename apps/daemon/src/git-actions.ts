import { guards } from '@flux/protocol';

import { DaemonError } from './daemon-error.ts';
import { inside } from './inside.ts';

// Commit, push and open a PR (prd.md § P2 story 4). Nothing here forces, rewrites history or
// touches a branch other than the worktree's own; the operator does that on the box if ever.

export type Runner = (cwd: string, args: string[]) => Promise<string>;

export interface PrOptions {
  title: string;
  body?: string;
  base?: string;
  draft?: boolean;
}

export interface GitActions {
  // Stages `paths` (all changes, untracked included, when omitted) and commits; returns the sha.
  commit: (worktree: string, message: string, paths?: string[]) => Promise<string>;
  // Sets the upstream on a branch's first push (or when asked); a plain `git push` otherwise.
  push: (worktree: string, setUpstream: boolean) => Promise<{ remote: string; branch: string }>;
  // The URL of the branch's PR, created now or already open.
  pr: (worktree: string, options: PrOptions) => Promise<string>;
}

const commit = async (
  git: Runner,
  worktree: string,
  message: string,
  paths: string[] | undefined,
): Promise<string> => {
  if (message.trim() === '') throw new DaemonError('bad_params', 'empty commit message');
  if (paths !== undefined && paths.length === 0) {
    throw new DaemonError('bad_params', 'no paths to commit');
  }
  // Absolute paths inside the worktree: `inside` refuses anything that climbs out of it, and
  // the `--` keeps a path that looks like an option from being read as one.
  const targets = paths === undefined ? ['.'] : paths.map((path) => inside(worktree, path));
  await git(worktree, ['add', '--all', '--', ...targets]);
  await git(worktree, ['commit', '--quiet', '--message', message]);
  return (await git(worktree, ['rev-parse', 'HEAD'])).trim();
};

const push = async (
  git: Runner,
  worktree: string,
  setUpstream: boolean,
): Promise<{ remote: string; branch: string }> => {
  const branch = (await git(worktree, ['symbolic-ref', '--short', 'HEAD'])).trim();
  const upstream = (
    await git(worktree, ['for-each-ref', '--format=%(upstream:remotename)', `refs/heads/${branch}`])
  ).trim();
  const remote = upstream === '' ? 'origin' : upstream;
  const args =
    setUpstream || upstream === '' ? ['push', '--set-upstream', remote, branch] : ['push'];
  await git(worktree, args);
  return { remote, branch };
};

const parsePrUrl = (json: string): string | null => {
  try {
    const view: unknown = JSON.parse(json);
    return guards.isRecord(view) && guards.isString(view['url']) ? view['url'] : null;
  } catch {
    return null;
  }
};

const pr = async (gh: Runner, worktree: string, options: PrOptions): Promise<string> => {
  if (options.title.trim() === '') throw new DaemonError('bad_params', 'empty PR title');
  // `gh pr view` fails when the branch has no PR; then create one. Any other failure (gh missing,
  // not logged in) surfaces from `gh pr create` with gh's own message.
  const existing = await gh(worktree, ['pr', 'view', '--json', 'url']).catch(() => null);
  const url = existing === null ? null : parsePrUrl(existing);
  if (url !== null) return url;
  const args = ['pr', 'create', '--title', options.title, '--body', options.body ?? ''];
  if (options.base !== undefined) args.push('--base', options.base);
  if (options.draft === true) args.push('--draft');
  return (await gh(worktree, args)).trim();
};

export const gitActions = (git: Runner, gh: Runner): GitActions => ({
  commit: (worktree, message, paths) => commit(git, worktree, message, paths),
  push: (worktree, setUpstream) => push(git, worktree, setUpstream),
  pr: (worktree, options) => pr(gh, worktree, options),
});
