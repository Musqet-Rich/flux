import { base64url, handshake, room } from '@flux/protocol';
import { expect, test } from 'vitest';

import { createMemoryStorage } from '../client/create-memory-storage.ts';
import type { Storage } from '../client/create-memory-storage.ts';
import type { PairedBoxRecord } from '../client/paired-box.ts';
import { pairedBox } from '../client/paired-box.ts';
import { pairings } from './pairings.ts';

// The pairings record (ADR 0037): the one pairing an app from before it kept carries over as the
// first entry with its cache where it was, entries that fail their guard are dropped, a storage
// that cannot be read is an error and not an empty list, and a new daemon's cache prefix never
// shares the bare one.

const record = async (): Promise<PairedBoxRecord> => {
  const box = await handshake.generateKeyPair();
  const device = await handshake.generateKeyPair(true);
  return (await pairedBox.create('https://relay.example', box.publicKey, device, 'dev-1')).record;
};

test('the single pairing from before carries over, keeping its cache, and the old key goes', async () => {
  const storage = createMemoryStorage();
  const legacy = await record();
  await storage.set(pairedBox.storageKey, legacy);
  await storage.set('log:s1:0', ['cached']);
  const id = await room.id(base64url.decode(legacy.boxPub));
  const loaded = await pairings.load(storage);
  expect(loaded).toEqual({
    active: id,
    entries: [{ id, name: null, cache: 'log:', rootPush: true, box: legacy }],
  });
  expect(await storage.get(pairings.storageKey)).toEqual(loaded);
  expect(await storage.get(pairedBox.storageKey)).toBeUndefined();
  expect(await storage.get('log:s1:0')).toEqual(['cached']);
  // Once carried over, the record is what is read: the same answer, nothing written again.
  expect(await pairings.load(storage)).toEqual(loaded);
});

test('a carry-over whose write fails keeps the old key and still opens the pairing', async () => {
  const backing = createMemoryStorage();
  const legacy = await record();
  await backing.set(pairedBox.storageKey, legacy);
  const failing: Storage = { ...backing, set: () => Promise.reject(new TypeError('quota')) };
  const loaded = await pairings.load(failing);
  expect(loaded.entries).toHaveLength(1);
  expect(await backing.get(pairedBox.storageKey)).toEqual(legacy);
});

test('nothing stored is no pairings; an unreadable storage rejects rather than look empty', async () => {
  expect(await pairings.load(createMemoryStorage())).toEqual({ active: null, entries: [] });
  const broken: Storage = {
    ...createMemoryStorage(),
    get: () => Promise.reject(new TypeError('indexeddb')),
  };
  await expect(pairings.load(broken)).rejects.toThrow('indexeddb');
});

test('entries that fail their guard are dropped, and an active id not among them is none', async () => {
  const storage = createMemoryStorage();
  const good = { id: 'a', name: 'work', cache: 'log:', rootPush: false, box: await record() };
  await storage.set(pairings.storageKey, {
    active: 'gone',
    entries: [good, { id: 'b', name: 7 }, 'junk'],
  });
  expect(await pairings.load(storage)).toEqual({ active: null, entries: [good] });
});

test('update writes what it changed and a new daemon gets the bare cache only while it is free', async () => {
  const storage = createMemoryStorage();
  const box = await record();
  const empty = await pairings.load(storage);
  expect(pairings.cacheFor(empty, 'a')).toBe('log:');
  const one = await pairings.update(storage, () => ({
    active: 'a',
    entries: [{ id: 'a', name: null, cache: 'log:', rootPush: false, box }],
  }));
  expect(pairings.cacheFor(one, 'b')).toBe('daemon:b:log:');
  expect(await pairings.load(storage)).toEqual(one);
});
