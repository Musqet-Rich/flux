import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { runCommand } from './run-command.ts';

const options = { cwd: tmpdir(), env: process.env, code: 'gh_error' as const };

// Resolves once the kernel has reaped `pid`: signal 0 probes without sending anything.
const gone = (pid: number): Promise<void> =>
  new Promise((resolve) => {
    const probe = (): void => {
      try {
        process.kill(pid, 0);
      } catch {
        resolve();
        return;
      }
      setImmediate(probe);
    };
    probe();
  });

test('returns stdout on success', async () => {
  expect(await runCommand('sh', ['-c', 'echo hi'], options)).toBe('hi\n');
});

test('a missing binary is reported by name, under the caller code', async () => {
  await expect(runCommand('flux-no-such-binary', [], options)).rejects.toMatchObject({
    code: 'gh_error',
    message: 'flux-no-such-binary not found on PATH',
  });
});

test('a failure carries stderr, or stdout when stderr is empty', async () => {
  await expect(runCommand('sh', ['-c', 'echo out; echo err >&2; exit 1'], options)).rejects.toThrow(
    'err',
  );
  await expect(runCommand('sh', ['-c', 'echo out; exit 1'], options)).rejects.toThrow('out');
});

test('a command that outlives its timeout is killed and reported', async () => {
  await expect(runCommand('sleep', ['30'], { ...options, timeoutMs: 20 })).rejects.toThrow(
    'sleep timed out',
  );
});

test('the timeout kills the whole process group, so a child of the command dies too', async () => {
  const pidFile = join(await mkdtemp(join(tmpdir(), 'flux-run-')), 'pid');
  const script = `sleep 30 & echo $! > "${pidFile}"; wait`;
  await expect(runCommand('sh', ['-c', script], { ...options, timeoutMs: 300 })).rejects.toThrow(
    'sh timed out',
  );
  const child = Number(await readFile(pidFile, 'utf8'));
  await gone(child);
  expect(() => process.kill(child, 0)).toThrow('ESRCH');
});
