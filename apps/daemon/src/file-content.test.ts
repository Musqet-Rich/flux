import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { fileContent } from './file-content.ts';

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9]);

test('fromBytes hashes the whole file and sends at most 1 MiB of it', () => {
  expect(fileContent.fromBytes(Buffer.from('hi\n'))).toEqual({
    content: 'hi\n',
    binary: false,
    hash: sha256('hi\n'),
    truncated: false,
  });
  const blob = Buffer.from([0, 1, 2]);
  expect(fileContent.fromBytes(blob)).toEqual({
    content: 'AAEC',
    binary: true,
    hash: sha256(blob),
    truncated: false,
  });
  const big = Buffer.alloc(fileContent.cap + 1, 'y');
  const shown = fileContent.fromBytes(big);
  expect(shown.truncated).toBe(true);
  expect(shown.content).toHaveLength(fileContent.cap);
  expect(shown.hash).toBe(sha256(big));
});

test('text that is not valid UTF-8 is binary, so a lossy decode is never written back', () => {
  expect(fileContent.fromBytes(latin1)).toEqual({
    content: latin1.toString('base64'),
    binary: true,
    hash: sha256(latin1),
    truncated: false,
  });
  // A multi-byte character cut by the cap does not make the whole file binary.
  const cut = Buffer.concat([Buffer.alloc(fileContent.cap - 1, 'a'), Buffer.from('é')]);
  const shown = fileContent.fromBytes(cut);
  expect(shown.binary).toBe(false);
  expect(shown.truncated).toBe(true);
  expect(shown.content.startsWith('aaa')).toBe(true);
});

test('read maps filesystem errors: missing is not_found, a directory is bad_params', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flux-fc-'));
  await expect(fileContent.read(join(dir, 'missing'))).rejects.toMatchObject({
    code: 'not_found',
  });
  await expect(fileContent.read(dir)).rejects.toMatchObject({ code: 'bad_params' });
  await writeFile(join(dir, 'f'), 'x');
  await expect(fileContent.read(join(dir, 'f', 'under'))).rejects.toMatchObject({
    code: 'bad_params',
  });
});

test('write lands the whole file or nothing, and honours ifMatch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flux-fc-'));
  const path = join(dir, 'a.txt');
  expect(await fileContent.write(path, 'one\n', null)).toBe(sha256('one\n'));
  expect(await readFile(path, 'utf8')).toBe('one\n');
  const stale = sha256('zero\n');
  await expect(fileContent.write(path, 'two\n', stale)).rejects.toMatchObject({
    code: 'conflict',
  });
  expect(await readFile(path, 'utf8')).toBe('one\n');
  expect(await fileContent.write(path, 'two\n', sha256('one\n'))).toBe(sha256('two\n'));
  expect(await readFile(path, 'utf8')).toBe('two\n');
  expect(await readdir(dir)).toEqual(['a.txt']);
});

test('write maps errors: gone with ifMatch is not_found, a directory in the way is bad_params', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flux-fc-'));
  await expect(fileContent.write(join(dir, 'new.txt'), 'y', sha256(''))).rejects.toMatchObject({
    code: 'not_found',
  });
  await expect(fileContent.write(join(dir, 'no', 'x'), 'y', null)).rejects.toMatchObject({
    code: 'not_found',
  });
  await mkdir(join(dir, 'd'));
  await expect(fileContent.write(join(dir, 'd'), 'y', null)).rejects.toMatchObject({
    code: 'bad_params',
  });
  await writeFile(join(dir, 'f'), 'x');
  await expect(fileContent.write(join(dir, 'f', 'under'), 'y', null)).rejects.toMatchObject({
    code: 'bad_params',
  });
});

test('write keeps the file mode; a new file gets the umask default', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flux-fc-'));
  const script = join(dir, 'run.sh');
  await writeFile(script, '#!/bin/sh\n');
  await chmod(script, 0o755);
  await fileContent.write(script, '#!/bin/sh\necho hi\n', null);
  expect((await stat(script)).mode & 0o777).toBe(0o755);
  const fresh = join(dir, 'fresh.txt');
  await fileContent.write(fresh, 'x', null);
  expect((await stat(fresh)).mode & 0o111).toBe(0);
});

test('two writes with the same ifMatch: exactly one wins, the other is a conflict', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'flux-fc-'));
  const path = join(dir, 'a.txt');
  await writeFile(path, 'base\n');
  const hash = sha256('base\n');
  const results = await Promise.allSettled([
    fileContent.write(path, 'first\n', hash),
    fileContent.write(path, 'second\n', hash),
  ]);
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
  expect(results[1]).toMatchObject({ reason: { code: 'conflict' } });
  expect(await readFile(path, 'utf8')).toBe('first\n');
  // The queue drains: a later write is not stuck behind the rejected one.
  expect(await fileContent.write(path, 'third\n', sha256('first\n'))).toBe(sha256('third\n'));
});
