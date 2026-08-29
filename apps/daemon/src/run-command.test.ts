import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';

import { runCommand } from './run-command.ts';

const options = { cwd: tmpdir(), env: process.env, code: 'gh_error' as const };

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
