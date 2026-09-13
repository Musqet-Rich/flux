import { execFileSync } from 'node:child_process';

// Runs git in a test's temp repository. GIT_* is dropped from the environment: under the
// pre-commit hook it points at the flux repository itself, and a `switch` there would move the
// developer's own checkout (it did once).
export const gitIn = (cwd: string, args: string[]): string => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );
  return execFileSync('git', args, { cwd, env, encoding: 'utf8' });
};
