import type { Commit, FileContent, FileStatus, Repo } from '@flux/protocol';
import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { DaemonError } from './daemon-error.ts';
import { fileContent } from './file-content.ts';
import type { GitActions, Runner } from './git-actions.ts';
import { gitActions } from './git-actions.ts';
import { runCommand } from './run-command.ts';

// Git and file operations by spawning `git` (architecture.md § Daemon, Git and fs service), and
// `gh` for pull requests. No git library. Every method takes the directory to run in; the daemon
// passes the worktree.

export interface DiffOptions {
  path?: string;
  from?: string;
  to?: string;
}

export interface GitService extends GitActions {
  status: (worktree: string) => Promise<FileStatus[]>;
  diff: (worktree: string, base: string, options: DiffOptions) => Promise<string>;
  show: (worktree: string, path: string, rev: string) => Promise<FileContent>;
  // The commits the session added on top of `base`, newest first; the base's own history is
  // not the session's work, and it is what the PR title and the "last commit" line are about.
  log: (worktree: string, base: string, limit: number) => Promise<Commit[]>;
  branches: (repo: string) => Promise<string[]>;
  revParse: (repo: string, rev: string) => Promise<string>;
  // `base` null checks out an existing branch instead of creating one.
  addWorktree: (repo: string, path: string, branch: string, base: string | null) => Promise<void>;
  // `force` throws away uncommitted work; without it git refuses a dirty worktree.
  removeWorktree: (repo: string, path: string, force: boolean) => Promise<void>;
  // Forgets worktrees whose directory is gone (`git worktree prune`): until then git still
  // counts their branch as checked out and refuses to delete it.
  pruneWorktrees: (repo: string) => Promise<void>;
  // `git branch -D`: git itself refuses the branch checked out anywhere, the daemon refuses
  // nothing more, so the operator can delete an unmerged branch on purpose.
  deleteBranch: (repo: string, branch: string) => Promise<void>;
  // Commits not on the branch's upstream; without an upstream, everything since `base`.
  unpushed: (worktree: string, base: string) => Promise<number>;
  listRepos: (root: string) => Promise<Repo[]>;
}

export interface GitServiceOptions {
  // The environment the commands run under; tests point HOME and PATH at temp directories.
  env?: NodeJS.ProcessEnv;
}

// A git hook (or anything launched from one) exports the variables that select a repository,
// which would point every command here at the wrong one; the cwd is the only selector. The
// rest of GIT_* stays: the operator's GIT_SSH_COMMAND is how a push reaches the remote. Neither
// tool may stop for a terminal prompt (credentials, gh's update notice): there is none.
const repoSelectors = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_INDEX_VERSION',
  'GIT_PREFIX',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES',
];

const cleanEnv = (source: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const env = { ...source };
  for (const key of repoSelectors) delete env[key];
  return { ...env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' };
};

const statusOf = (xy: string): FileStatus['status'] => {
  if (xy === '??') return '?';
  const code = xy.trim().charAt(0);
  if (code === 'A' || code === 'D' || code === 'R') return code;
  return 'M';
};

// `git status --porcelain -z`: `XY path\0`, and renames add `\0oldpath`.
const parseStatus = (raw: string): FileStatus[] => {
  const parts = raw.split('\0');
  const files: FileStatus[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i] ?? '';
    if (entry.length < 4) continue;
    const status = statusOf(entry.slice(0, 2));
    const path = entry.slice(3);
    if (status === 'R') {
      const from = parts[++i] ?? '';
      files.push({ path, status, from });
    } else {
      files.push({ path, status });
    }
  }
  return files;
};

const parseLog = (raw: string): Commit[] =>
  raw
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [sha = '', subject = '', author = '', ts = ''] = line.split('');
      return { sha, subject, author, ts };
    });

// A blob at a rev comes back through the runner's UTF-8 decode; the worktree is read as bytes.
const show = (git: Runner, worktree: string, path: string, rev: string): Promise<FileContent> =>
  rev === 'worktree'
    ? fileContent.read(join(worktree, path))
    : git(worktree, ['show', `${rev}:${path}`]).then((out) =>
        fileContent.fromBytes(Buffer.from(out, 'utf8')),
      );

const localBranches = async (git: Runner, repo: string): Promise<string[]> =>
  (await git(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']))
    .split('\n')
    .filter((line) => line !== '');

const listRepos = async (git: Runner, root: string): Promise<Repo[]> => {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => {
    throw new DaemonError('not_found', `repositories directory ${root} is missing or unreadable`);
  });
  const candidates = entries.filter((e) => e.isDirectory()).map((e) => join(root, e.name));
  const repos = await Promise.all(
    candidates.map(async (path): Promise<Repo | null> => {
      const gitDir = await stat(join(path, '.git')).catch(() => null);
      if (gitDir === null) return null;
      return { path, name: basename(path), branches: await localBranches(git, path) };
    }),
  );
  return repos.filter((repo): repo is Repo => repo !== null);
};

const unpushed = async (git: Runner, worktree: string, base: string): Promise<number> => {
  const upstream = await git(worktree, ['rev-parse', '--verify', '--quiet', '@{upstream}']).then(
    (out) => out.trim(),
    () => base,
  );
  return Number((await git(worktree, ['rev-list', '--count', `${upstream}..HEAD`])).trim());
};

export const createGitService = (options: GitServiceOptions = {}): GitService => {
  const env = cleanEnv(options.env ?? process.env);
  const git: Runner = (cwd, args) => runCommand('git', args, { cwd, env, code: 'git_error' });
  const gh: Runner = (cwd, args) => runCommand('gh', args, { cwd, env, code: 'gh_error' });
  return {
    ...gitActions(git, gh),
    status: async (worktree) => parseStatus(await git(worktree, ['status', '--porcelain', '-z'])),
    diff: (worktree, base, opts) => {
      const from = opts.from ?? base;
      const revs = opts.to === undefined || opts.to === 'worktree' ? [from] : [from, opts.to];
      const path = opts.path === undefined ? [] : ['--', opts.path];
      return git(worktree, ['diff', '--no-color', ...revs, ...path]);
    },
    show: (worktree, path, rev) => show(git, worktree, path, rev),
    log: async (worktree, base, limit) =>
      parseLog(
        await git(worktree, [
          'log',
          '--format=%H%x1f%s%x1f%an%x1f%aI',
          '-n',
          String(limit),
          `${base}..HEAD`,
        ]),
      ),
    branches: (repo) => localBranches(git, repo),
    revParse: async (repo, rev) => (await git(repo, ['rev-parse', '--verify', rev])).trim(),
    addWorktree: async (repo, path, branch, base) => {
      const args = base === null ? [path, branch] : ['-b', branch, path, base];
      await git(repo, ['worktree', 'add', ...args]);
    },
    removeWorktree: async (repo, path, force) => {
      await git(repo, ['worktree', 'remove', ...(force ? ['--force'] : []), path]);
    },
    pruneWorktrees: async (repo) => {
      await git(repo, ['worktree', 'prune']);
    },
    deleteBranch: async (repo, branch) => {
      await git(repo, ['branch', '-D', branch]);
    },
    unpushed: (worktree, base) => unpushed(git, worktree, base),
    listRepos: (root) => listRepos(git, root),
  };
};
