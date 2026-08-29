import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import type { AttachmentStore } from './create-attachment-store.ts';
import { createAttachmentStore } from './create-attachment-store.ts';
import { DaemonError } from './daemon-error.ts';
import { openDatabase } from './open-database.ts';

// Real SQLite, real files in a temp dir (engineering.md § Testing). The clock is injected so
// the lazy cleanup can be driven without waiting.

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

const setup = async (): Promise<{ store: AttachmentStore; dir: string; clock: { at: Date } }> => {
  const dir = await mkdtemp(join(tmpdir(), 'flux-attach-'));
  const clock = { at: new Date('2026-08-29T10:00:00Z') };
  const store = createAttachmentStore({ db: openDatabase(':memory:'), dir, now: () => clock.at });
  return { store, dir, clock };
};

// The code of the DaemonError a synchronous call throws.
const thrown = (fn: () => unknown): string => {
  try {
    fn();
    return 'none';
  } catch (error) {
    return error instanceof DaemonError ? error.code : 'other';
  }
};

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

// Uploads `data` in chunks of `chunk` bytes and ends with its real hash.
const upload = async (
  store: AttachmentStore,
  session: string,
  name: string,
  data: Buffer,
  chunk = 4,
): Promise<{ id: string; path: string }> => {
  const id = await store.begin(session, name, 'application/octet-stream', data.length);
  const pieces: Promise<void>[] = [];
  for (let i = 0; i * chunk < data.length; i += 1) {
    pieces.push(store.chunk(id, i, data.subarray(i * chunk, (i + 1) * chunk).toString('base64')));
  }
  await Promise.all(pieces);
  const { path } = await store.end(id, sha256(data));
  return { id, path };
};

test('begin, chunks in order, end: the file lands under the session with a safe name', async () => {
  const { store, dir } = await setup();
  const data = Buffer.from('hello attachments');
  const { id, path } = await upload(store, 's1', 'my shot (1).png', data, 5);
  expect(path).toBe(join(dir, 's1', `${id}-my_shot__1_.png`));
  expect(await readFile(path)).toEqual(data);
  const [record] = store.get('s1', [id]);
  expect(record).toMatchObject({ id, session: 's1', name: 'my_shot__1_.png', size: data.length });
  expect(record?.hash).toBe(sha256(data));
  expect(record?.complete).toBe(true);
  expect(record?.sentSeq).toBeNull();
  const slice = await store.read(id, 6, 5);
  expect(Buffer.from(slice.data, 'base64').toString()).toBe('attac');
  expect(slice).toMatchObject({ size: data.length, mime: 'application/octet-stream' });
  expect(Buffer.from((await store.read(id, 15, 100)).data, 'base64').toString()).toBe('ts');
  store.markSent([id], 7);
  expect(store.get('s1', [id])[0]?.sentSeq).toBe(7);
});

test('a chunk out of order, repeated, oversized or beyond the declared size is refused', async () => {
  const { store } = await setup();
  const id = await store.begin('s1', 'a.bin', 'application/octet-stream', 8);
  await expect(store.chunk(id, 1, 'AA==')).rejects.toMatchObject({ code: 'bad_params' });
  await store.chunk(id, 0, Buffer.from('abcd').toString('base64'));
  await expect(store.chunk(id, 0, 'AA==')).rejects.toMatchObject({ code: 'bad_params' });
  await expect(store.chunk(id, 1, Buffer.from('efghijk').toString('base64'))).rejects.toMatchObject(
    { code: 'bad_params', message: /declared size/u },
  );
  const big = Buffer.alloc(512 * 1024 + 1).toString('base64');
  await expect(store.chunk(id, 1, big)).rejects.toMatchObject({ message: /512 KiB/u });
  await expect(store.chunk('nope', 0, 'AA==')).rejects.toMatchObject({ code: 'not_found' });
});

test('a hash mismatch or a short upload deletes the partial file and its row', async () => {
  const { store, dir } = await setup();
  const id = await store.begin('s1', 'a.bin', 'application/octet-stream', 4);
  await store.chunk(id, 0, Buffer.from('abcd').toString('base64'));
  await expect(store.end(id, 'deadbeef')).rejects.toMatchObject({
    code: 'bad_params',
    message: /hash mismatch/u,
  });
  expect(await readdir(join(dir, 's1'))).toEqual([]);
  expect(thrown(() => store.get('s1', [id]))).toBe('not_found');
  const short = await store.begin('s1', 'b.bin', 'application/octet-stream', 4);
  await store.chunk(short, 0, Buffer.from('ab').toString('base64'));
  await expect(store.end(short, sha256(Buffer.from('ab')))).rejects.toMatchObject({
    message: /fewer bytes/u,
  });
  await expect(store.end('nope', 'x')).rejects.toMatchObject({ code: 'not_found' });
});

test('the per-file cap is too_large; get refuses another session and an unfinished upload', async () => {
  const { store } = await setup();
  await expect(store.begin('s1', 'a', 'x', 20 * 1024 * 1024 + 1)).rejects.toMatchObject({
    code: 'too_large',
  });
  const { id } = await upload(store, 's1', 'a.txt', Buffer.from('abc'));
  expect(thrown(() => store.get('s2', [id]))).toBe('bad_params');
  const open = await store.begin('s1', 'b.txt', 'text/plain', 3);
  expect(thrown(() => store.get('s1', [open]))).toBe('bad_params');
  await expect(store.read(open, 0, 1)).rejects.toMatchObject({ code: 'not_found' });
  expect(thrown(() => store.get('s1', ['nope']))).toBe('not_found');
});

test('a session id that escapes the directory is refused before anything is written', async () => {
  const { store, dir } = await setup();
  await expect(store.begin('../outside', 'a', 'x', 1)).rejects.toMatchObject({
    code: 'bad_params',
  });
  await expect(store.removeSession('../outside')).rejects.toMatchObject({ code: 'bad_params' });
  expect(await exists(join(dir, '..', 'outside'))).toBe(false);
  const { path } = await upload(store, 's1', '../../etc/passwd', Buffer.from('x'));
  expect(path.startsWith(join(dir, 's1') + '/')).toBe(true);
  expect(path.endsWith('-_.._etc_passwd')).toBe(true);
});

test('remove deletes a finished attachment or aborts an open upload', async () => {
  const { store, dir } = await setup();
  const { id, path } = await upload(store, 's1', 'a.txt', Buffer.from('abc'));
  await store.remove(id);
  expect(await exists(path)).toBe(false);
  await expect(store.remove(id)).rejects.toMatchObject({ code: 'not_found' });
  const open = await store.begin('s1', 'b.txt', 'text/plain', 3);
  await store.chunk(open, 0, Buffer.from('ab').toString('base64'));
  await store.remove(open);
  expect(await readdir(join(dir, 's1'))).toEqual([]);
  await expect(store.chunk(open, 1, 'AA==')).rejects.toMatchObject({ code: 'not_found' });
});

test('removeSession takes the directory, its rows and any open upload', async () => {
  const { store, dir } = await setup();
  const { id } = await upload(store, 's1', 'a.txt', Buffer.from('abc'));
  const open = await store.begin('s1', 'b.txt', 'text/plain', 3);
  const other = await upload(store, 's2', 'c.txt', Buffer.from('abc'));
  await store.removeSession('s1');
  expect(await exists(join(dir, 's1'))).toBe(false);
  expect(thrown(() => store.get('s1', [id]))).toBe('not_found');
  await expect(store.chunk(open, 0, 'AA==')).rejects.toMatchObject({ code: 'not_found' });
  expect(store.get('s2', [other.id])).toHaveLength(1);
  await store.removeSession('never-had-any');
});

test('cleanup is lazy: stale uploads go after 10 minutes, unsent files after 24 hours', async () => {
  const { store, dir, clock } = await setup();
  const stuck = await store.begin('s1', 'stuck.bin', 'x', 4);
  await store.chunk(stuck, 0, 'AA==');
  const unsent = await upload(store, 's1', 'unsent.txt', Buffer.from('abc'));
  const sent = await upload(store, 's1', 'sent.txt', Buffer.from('abc'));
  store.markSent([sent.id], 3);
  expect(await store.sweep()).toBe(0);
  clock.at = new Date(clock.at.getTime() + 11 * 60 * 1000);
  // `begin` sweeps before it stores, so the stuck upload goes then.
  const later = await store.begin('s1', 'later.txt', 'text/plain', 1);
  await expect(store.chunk(stuck, 1, 'AA==')).rejects.toMatchObject({ code: 'not_found' });
  expect(await exists(unsent.path)).toBe(true);
  clock.at = new Date(clock.at.getTime() + 24 * 60 * 60 * 1000);
  expect(await store.sweep()).toBe(2);
  expect(await exists(unsent.path)).toBe(false);
  expect(await exists(sent.path)).toBe(true);
  await expect(store.chunk(later, 0, 'AA==')).rejects.toMatchObject({ code: 'not_found' });
  expect(await readdir(join(dir, 's1'))).toEqual([`${sent.id}-sent.txt`]);
});

test('an empty file is a valid attachment', async () => {
  const { store } = await setup();
  const { id, path } = await upload(store, 's1', 'empty', Buffer.alloc(0));
  expect(await readFile(path)).toHaveLength(0);
  expect((await store.read(id, 0, 10)).data).toBe('');
});
