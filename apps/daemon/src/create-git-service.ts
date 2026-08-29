import type { Commit, FileStatus, Repo } from '@flux/protocol';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { DaemonError } from './daemon-error.ts';
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

export interface FileContent {
  content: string;
  binary: boolean;
}

export interface GitService extends GitActions {
  status: (worktree: string) => Promise<FileStatus[]>;
  diff: (worktree: string, base: string, options: DiffOptions) => Promise<string>;
  show: (worktree: string, path: string, rev: string) => Promise<FileContent>;
  log: (worktree: string, limit: number) => Promise<Commit[]>;
  branches: (repo: string) => Promise<string[]>;
  revParse: (repo: string, rev: string) => Promise<string>;
  // `base` null checks out an existing branch instead of creating one.
  addWorktree: (repo: string, path: string, branch: string, base: string | null) => Promise<void>;
  removeWorktree: (repo: string, path: string) => Promise<void>;
  listRepos: (root: string) => Promise<Repo[]>;
}

export interface GitServiceOptions {
  // The environment the commands run under; tests point HOME and PATH at temp directories.
  env?: NodeJS.ProcessEnv;
}

// A git hook (or anything launched from one) exports GIT_DIR and friends, which would point
// every command here at the wrong repository. The cwd is the only repository selector.
const cleanEnv = (source: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const env = { ...source };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return env;
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

const isBinary = (data: Buffer): boolean => data.subarray(0, 8000).includes(0);

const toContent = (data: Buffer): FileContent => {
  const binary = isBinary(data);
  return { content: binary ? data.toString('base64') : data.toString('utf8'), binary };
};

const parseLog = (raw: string): Commit[] =>
  raw
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [sha = '', subject = '', author = '', ts = ''] = line.split('');
      return { sha, subject, author, ts };
    });

const show = async (git: Runner, worktree: string, path: string, rev: string) => {
  if (rev === 'worktree') {
    try {
      return toContent(await readFile(join(worktree, path)));
    } catch (error) {
      throw new DaemonError('not_found', error instanceof Error ? error.message : String(error));
    }
  }
  return toContent(Buffer.from(await git(worktree, ['show', `${rev}:${path}`]), 'utf8'));
};

const localBranches = async (git: Runner, repo: string): Promise<string[]> =>
  (await git(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']))
    .split('\n')
    .filter((line) => line !== '');

const listRepos = async (git: Runner, root: string): Promise<Repo[]> => {
  const entries = await readdir(root, { withFileTypes: true });
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
    log: async (worktree, limit) =>
      parseLog(
        await git(worktree, ['log', '--format=%H%x1f%s%x1f%an%x1f%aI', '-n', String(limit)]),
      ),
    branches: (repo) => localBranches(git, repo),
    revParse: async (repo, rev) => (await git(repo, ['rev-parse', '--verify', rev])).trim(),
    addWorktree: async (repo, path, branch, base) => {
      const args = base === null ? [path, branch] : ['-b', branch, path, base];
      await git(repo, ['worktree', 'add', ...args]);
    },
    removeWorktree: async (repo, path) => {
      await git(repo, ['worktree', 'remove', '--force', path]);
    },
    listRepos: (root) => listRepos(git, root),
  };
};
