import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A fresh git repository in a temp directory with one untracked file, for supervisor tests.
// GIT_* is dropped from the environment: under the pre-commit hook it points at the flux repo.
export const tempWorktree = async (): Promise<string> => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );
  const worktree = await mkdtemp(join(tmpdir(), 'flux-sup-'));
  execFileSync('git', ['init', '-q'], { cwd: worktree, env });
  await writeFile(join(worktree, 'notes.txt'), 'hello\n');
  return worktree;
};
