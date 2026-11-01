import type { Bytes } from '@flux/protocol';
import { base64url, guards, room } from '@flux/protocol';

import type { Storage } from '../client/create-memory-storage.ts';
import type { PairedBoxRecord } from '../client/paired-box.ts';
import { pairedBox } from '../client/paired-box.ts';

// The daemons this device is paired with (ADR 0037), kept in storage under `storageKey` as one
// record: every pairing, and which of them the app opened last. A pairing is known by its
// daemon's room id (protocol.md § 1), which is derived from the daemon's static public key, so
// it is stable for the daemon's life, the same whichever relay the link named, and already
// public to the relay; the public key itself never goes in a URL, since a relay that saw it
// could claim the daemon's room. `name` is the daemon's own name from `hello`, null until the
// first one. `cache` is the prefix the daemon's cached logs live under (log-cache.ts): the bare
// `log:` the app used before there could be more than one daemon, for the first daemon to hold
// it, and a namespace of the daemon's own for the rest, so a pairing that came from before
// keeps its cache where it is. `rootPush` marks the pairing carried over from before, whose
// push subscription may still be on the root service worker (subscribe-push.ts) until it moves.
//
// Every change reads the record afresh and writes it whole, holding the storage's exclusive
// lock across the read and the write where it has one (a Web Lock in the browser), so a second
// tab of the app that pairs another daemon meanwhile cannot have its entry written over by this
// tab's older copy. This tab's changes also queue behind one another (`writes`), which is the
// whole guard where there is no lock, so two at once (a daemon's name and its push moving)
// cannot each write over the other's.

export interface Pairing {
  id: string;
  name: string | null;
  cache: string;
  rootPush: boolean;
  box: PairedBoxRecord;
}

export interface Pairings {
  active: string | null;
  entries: Pairing[];
}

const storageKey = 'pairings';
const bareCache = 'log:';

const { isString, isRecord, isBoolean } = guards;

const isPairing = (v: unknown): v is Pairing =>
  isRecord(v) &&
  isString(v['id']) &&
  (v['name'] === null || isString(v['name'])) &&
  isString(v['cache']) &&
  // Forgetting a daemon clears its cache prefix, so only a prefix this app hands out is trusted:
  // an empty one would clear the whole store, the pairings with it.
  (v['cache'] === bareCache || v['cache'].startsWith('daemon:')) &&
  isBoolean(v['rootPush']) &&
  pairedBox.isRecord(v['box']);

const isPairings = (v: unknown): v is { active: unknown; entries: unknown[] } =>
  isRecord(v) && Array.isArray(v['entries']);

// A copy with nothing reactive in it: IndexedDB's structured clone refuses a Vue proxy.
const plain = (p: Pairings): Pairings => ({
  active: p.active,
  entries: p.entries.map((e) => ({ ...e, box: { ...e.box } })),
});

const idOf = (boxPub: Bytes): Promise<string> => room.id(boxPub);

// Where a newly paired daemon's logs are cached: the bare prefix while no pairing holds it,
// else a namespace of its own. Every namespace starts outside `log:`, so clearing the bare
// prefix when its daemon is forgotten never reaches another daemon's cache.
const cacheFor = (pairings: Pairings, id: string): string =>
  pairings.entries.some((e) => e.cache === bareCache) ? `daemon:${id}:log:` : bareCache;

// The single pairing an app from before ADR 0037 kept under `paired-box`, as the first entry.
// The new record is written before the old key is removed, so a failure between the two leaves
// the old key behind (read again next time, and harmless once the new record exists) and never
// neither; a write that fails outright still returns the pairing, to use until the next boot.
const migrate = async (storage: Storage): Promise<Pairings> => {
  const legacy: unknown = await storage.get(pairedBox.storageKey);
  if (!pairedBox.isRecord(legacy)) return { active: null, entries: [] };
  // A key that does not decode could never connect; read as nothing rather than fail every load.
  const decoded = async (): Promise<string> => idOf(base64url.decode(legacy.boxPub));
  const id = await decoded().catch(() => null);
  if (id === null) return { active: null, entries: [] };
  const pairings: Pairings = {
    active: id,
    entries: [{ id, name: null, cache: bareCache, rootPush: true, box: { ...legacy } }],
  };
  try {
    await storage.set(storageKey, plain(pairings));
    await storage.remove(pairedBox.storageKey);
  } catch {
    // Kept in memory; the old key is still there for the next boot to carry over.
  }
  return pairings;
};

// Rejects only when storage cannot be read at all, so a caller never mistakes a broken
// storage for an empty one and writes over pairings it could not see. An entry that fails its
// guard is dropped and the rest are kept.
const load = async (storage: Storage): Promise<Pairings> => {
  const stored: unknown = await storage.get(storageKey);
  if (!isPairings(stored)) return migrate(storage);
  const entries = stored.entries.filter(isPairing);
  const { active } = stored;
  const known = isString(active) && entries.some((e) => e.id === active);
  return { active: known ? active : null, entries };
};

const save = (storage: Storage, pairings: Pairings): Promise<void> =>
  storage.set(storageKey, plain(pairings));

const writes = new WeakMap<Storage, Promise<unknown>>();
const lockName = 'flux-pairings';

// Reads, changes and writes the record, after this tab's changes before it, resolving to what
// was written.
const update = (storage: Storage, change: (current: Pairings) => Pairings): Promise<Pairings> => {
  const run = async (): Promise<Pairings> => {
    const next = change(await load(storage));
    await save(storage, next);
    return next;
  };
  const locked = (): Promise<Pairings> =>
    storage.exclusive === undefined ? run() : storage.exclusive(lockName, run);
  const queued = (writes.get(storage) ?? Promise.resolve()).then(locked, locked);
  writes.set(
    storage,
    queued.catch(() => null),
  );
  return queued;
};

export const pairings: {
  storageKey: string;
  bareCache: string;
  idOf: typeof idOf;
  cacheFor: typeof cacheFor;
  load: typeof load;
  update: typeof update;
} = { storageKey, bareCache, idOf, cacheFor, load, update };
