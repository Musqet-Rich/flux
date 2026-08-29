import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test } from 'vitest';

import { acquireDaemonLock } from './acquire-daemon-lock.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'flux-lock-'));
});

// A pid that no longer exists: a child that has just exited.
const deadPid = (): Promise<number> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', '']);
    child.once('exit', () => {
      resolve(child.pid ?? 0);
    });
  });

test('the lock names this process and refuses a second holder while it lives', async () => {
  const lock = acquireDaemonLock(dir);
  expect(lock.path).toBe(join(dir, 'daemon.lock'));
  expect(await readFile(lock.path, 'utf8')).toBe(`${process.pid}\n`);
  expect(() => acquireDaemonLock(dir)).toThrow(`another flux daemon (pid ${process.pid}) holds`);
  lock.release();
  const again = acquireDaemonLock(dir);
  again.release();
  await expect(readFile(lock.path, 'utf8')).rejects.toThrow('ENOENT');
});

test('a lock left by a dead daemon, or one that is not a pid, is replaced', async () => {
  const path = join(dir, 'daemon.lock');
  await writeFile(path, `${await deadPid()}\n`);
  const lock = acquireDaemonLock(dir);
  expect(await readFile(path, 'utf8')).toBe(`${process.pid}\n`);
  lock.release();
  await writeFile(path, 'not a pid');
  const replaced = acquireDaemonLock(dir);
  expect(await readFile(path, 'utf8')).toBe(`${process.pid}\n`);
  replaced.release();
});
