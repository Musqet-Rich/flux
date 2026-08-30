import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { DaemonError } from '../daemon-error.ts';
import { realServiceIo } from './real-service-io.ts';

const scratch = (): string => mkdtempSync(join(tmpdir(), 'flux-svcio-'));

test('writes a file with the given mode, sees it, then removes it', async () => {
  const dir = scratch();
  const file = join(dir, 'sub', 'unit.service');
  await realServiceIo.mkdirp(join(dir, 'sub'));
  await realServiceIo.writeFile(file, 'body\n', 0o640);
  expect(realServiceIo.exists(file)).toBe(true);
  expect(readFileSync(file, 'utf8')).toBe('body\n');
  expect(statSync(file).mode & 0o777).toBe(0o640);
  await realServiceIo.removeFile(file);
  expect(realServiceIo.exists(file)).toBe(false);
  // Removing an absent file is a no-op (force), not an error.
  await expect(realServiceIo.removeFile(file)).resolves.toBeUndefined();
});

test('run captures stdout, stderr and a zero exit', async () => {
  const result = await realServiceIo.run([
    process.execPath,
    '-e',
    'process.stdout.write("out");process.stderr.write("err")',
  ]);
  expect(result).toEqual({ code: 0, stdout: 'out', stderr: 'err' });
});

test('run reports a non-zero exit as data, not a throw', async () => {
  const result = await realServiceIo.run([process.execPath, '-e', 'process.exit(2)']);
  expect(result.code).toBe(2);
});

test('run maps a signal death to a non-zero code', async () => {
  const result = await realServiceIo.run([
    process.execPath,
    '-e',
    'process.kill(process.pid,"SIGKILL")',
  ]);
  expect(result.code).toBe(1);
});

test('run rejects a missing binary with a DaemonError', async () => {
  await expect(realServiceIo.run(['flux-no-such-binary-zzz'])).rejects.toThrow(DaemonError);
  await expect(realServiceIo.run(['flux-no-such-binary-zzz'])).rejects.toThrow('not found on PATH');
});

test('run rejects an empty argv and a non-executable file', async () => {
  await expect(realServiceIo.run([])).rejects.toThrow(DaemonError);
  const dir = scratch();
  const file = join(dir, 'not-exec');
  writeFileSync(file, 'x');
  chmodSync(file, 0o644);
  await expect(realServiceIo.run([file])).rejects.toThrow(DaemonError);
});
