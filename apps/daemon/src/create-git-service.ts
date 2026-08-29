import type { Commit, FileStatus, Repo } from '@flux/protocol';
import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { DaemonError } from './daemon-error.ts';

// Git and file operations by spawning `git` (architecture.md § Daemon, Git and fs service). No
// git library. Every method takes the directory to run in; the daemon passes the worktree.

export interface DiffOptions {
  path?: string;
  from?: string;
  to?: string;
}

export interface FileContent {
  content: string;
  binary: boolean;
}

export interface GitService {
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

const maxBuffer = 64 * 1024 * 1024;

// A git hook (or anything launched from one) exports GIT_DIR and friends, which would point
// every command here at the wrong repository. The cwd is the only repository selector.
const cleanEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return env;
};

const git = (cwd: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const options = { cwd, maxBuffer, encoding: 'utf8', env: cleanEnv() } as const;
    execFile('git', args, options, (error, stdout, stderr) => {
      if (error) reject(new DaemonError('git_error', stderr.trim() || error.message));
      else resolve(stdout);
    });
  });

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

export const createGitService = (): GitService => ({
  status: async (worktree) => parseStatus(await git(worktree, ['status', '--porcelain', '-z'])),
  diff: (worktree, base, options) => {
    const from = options.from ?? base;
    const revs =
      options.to === undefined || options.to === 'worktree' ? [from] : [from, options.to];
    const path = options.path === undefined ? [] : ['--', options.path];
    return git(worktree, ['diff', '--no-color', ...revs, ...path]);
  },
  show: async (worktree, path, rev) => {
    if (rev === 'worktree') {
      try {
        return toContent(await readFile(join(worktree, path)));
      } catch (error) {
        throw new DaemonError('not_found', error instanceof Error ? error.message : String(error));
      }
    }
    return toContent(Buffer.from(await git(worktree, ['show', `${rev}:${path}`]), 'utf8'));
  },
  log: async (worktree, limit) =>
    parseLog(await git(worktree, ['log', '--format=%H%x1f%s%x1f%an%x1f%aI', '-n', String(limit)])),
  branches: async (repo) =>
    (await git(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']))
      .split('\n')
      .filter((line) => line !== ''),
  revParse: async (repo, rev) => (await git(repo, ['rev-parse', '--verify', rev])).trim(),
  addWorktree: async (repo, path, branch, base) => {
    const args = base === null ? [path, branch] : ['-b', branch, path, base];
    await git(repo, ['worktree', 'add', ...args]);
  },
  removeWorktree: async (repo, path) => {
    await git(repo, ['worktree', 'remove', '--force', path]);
  },
  listRepos: async (root) => {
    const entries = await readdir(root, { withFileTypes: true });
    const candidates = entries.filter((e) => e.isDirectory()).map((e) => join(root, e.name));
    const repos = await Promise.all(
      candidates.map(async (path): Promise<Repo | null> => {
        const gitDir = await stat(join(path, '.git')).catch(() => null);
        if (gitDir === null) return null;
        const names = await git(path, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
        const branches = names.split('\n').filter((line) => line !== '');
        return { path, name: basename(path), branches };
      }),
    );
    return repos.filter((repo): repo is Repo => repo !== null);
  },
});
