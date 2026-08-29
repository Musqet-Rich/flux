import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A repositories directory holding one repository `app` with a single commit on `main`, for
// daemon tests. GIT_* is dropped from the environment: under the pre-commit hook it points at
// the flux repo.

const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
);

const git = (cwd: string, args: string[]): void => {
  execFileSync('git', ['-c', 'user.email=t@x', '-c', 'user.name=t', ...args], {
    cwd,
    env: gitEnv,
  });
};

export const tempRepo = async (): Promise<{ root: string; repos: string; repo: string }> => {
  const root = await mkdtemp(join(tmpdir(), 'flux-daemon-'));
  const repos = join(root, 'repos');
  const repo = join(repos, 'app');
  await mkdir(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', 'main']);
  await writeFile(join(repo, 'README.md'), '# app\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'init']);
  return { root, repos, repo };
};
