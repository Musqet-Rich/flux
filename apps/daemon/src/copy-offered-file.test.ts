import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { copyOfferedFile } from './copy-offered-file.ts';

// Real files in a temp dir (engineering.md § Testing). What the agent may offer is a regular file
// within the cap; everything else is refused with an error it can read, and nothing is left at
// the target. The permission cases assume the suite does not run as root, as neither the box
// nor CI does: root reads anything.

const limit = 16;

const setup = async (): Promise<{ dir: string; target: string }> => {
  const dir = await mkdtemp(join(tmpdir(), 'flux-offer-'));
  return { dir, target: join(dir, 'store', 's1', 'id-copy.txt') };
};

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

test('copies a regular file, creating the directory, and returns its size and sha256', async () => {
  const { dir, target } = await setup();
  const source = join(dir, 'report.txt');
  await writeFile(source, 'quarterly');
  const copied = await copyOfferedFile(source, target, limit);
  expect(copied).toEqual({
    size: 9,
    hash: createHash('sha256').update('quarterly').digest('hex'),
  });
  expect(await readFile(target, 'utf8')).toBe('quarterly');
  // A copy, not a reference: the source changing afterwards leaves it as it was.
  await writeFile(source, 'rewritten');
  expect(await readFile(target, 'utf8')).toBe('quarterly');
});

test('an empty file is a file like any other', async () => {
  const { dir, target } = await setup();
  const source = join(dir, 'empty');
  await writeFile(source, '');
  expect((await copyOfferedFile(source, target, limit)).size).toBe(0);
});

test('a missing path, or one through a file, is not_found', async () => {
  const { dir, target } = await setup();
  await expect(copyOfferedFile(join(dir, 'nope.txt'), target, limit)).rejects.toMatchObject({
    code: 'not_found',
    message: expect.stringContaining('no file at'),
  });
  await writeFile(join(dir, 'plain'), 'x');
  await expect(copyOfferedFile(join(dir, 'plain', 'x'), target, limit)).rejects.toMatchObject({
    code: 'not_found',
  });
  expect(await exists(target)).toBe(false);
});

test('a directory is refused, with a message that says so', async () => {
  const { dir, target } = await setup();
  const source = join(dir, 'folder');
  await mkdir(source);
  await expect(copyOfferedFile(source, target, limit)).rejects.toMatchObject({
    code: 'bad_params',
    message: expect.stringContaining('is a directory'),
  });
});

test('a FIFO is refused without blocking on it', async () => {
  const { dir, target } = await setup();
  const source = join(dir, 'pipe');
  execFileSync('mkfifo', [source]);
  await expect(copyOfferedFile(source, target, limit)).rejects.toMatchObject({
    code: 'bad_params',
    message: expect.stringContaining('not a regular file'),
  });
  expect(await exists(target)).toBe(false);
});

test('a file over the cap is too_large and nothing is written; one at the cap copies', async () => {
  const { dir, target } = await setup();
  const source = join(dir, 'big.bin');
  await writeFile(source, Buffer.alloc(limit + 1));
  await expect(copyOfferedFile(source, target, limit)).rejects.toMatchObject({
    code: 'too_large',
    message: expect.stringContaining('at most'),
  });
  expect(await exists(target)).toBe(false);
  await writeFile(source, Buffer.alloc(limit));
  expect((await copyOfferedFile(source, target, limit)).size).toBe(limit);
});

test('a file the agent cannot read, or cannot reach, is refused as unreadable', async () => {
  const { dir, target } = await setup();
  const source = join(dir, 'secret.txt');
  await writeFile(source, 'x');
  await chmod(source, 0o000);
  await expect(copyOfferedFile(source, target, limit)).rejects.toMatchObject({
    code: 'bad_params',
    message: expect.stringContaining('cannot read'),
  });
  const shut = join(dir, 'shut');
  await mkdir(shut);
  await writeFile(join(shut, 'inner.txt'), 'x');
  await chmod(shut, 0o000);
  await expect(copyOfferedFile(join(shut, 'inner.txt'), target, limit)).rejects.toMatchObject({
    code: 'bad_params',
    message: expect.stringContaining('cannot read'),
  });
  await chmod(shut, 0o700);
});

// A file whose size the stat cannot know (a /proc file stats as empty) is held to the cap by the
// bytes themselves, and the partial copy is removed.
test('a file that turns out larger than its stat said is refused mid-copy', async () => {
  const { target } = await setup();
  await expect(copyOfferedFile('/proc/self/status', target, 1)).rejects.toMatchObject({
    code: 'too_large',
    message: expect.stringContaining('while it was copied'),
  });
  expect(await exists(target)).toBe(false);
});
