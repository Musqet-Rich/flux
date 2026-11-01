import { ClientError } from '../client/client-error.ts';
import type { Connection } from '../client/create-connection.ts';
import { createConnection } from '../client/create-connection.ts';
import { pairedBox } from '../client/paired-box.ts';
import { boxLink } from './box-link.ts';
import { logCache } from './log-cache.ts';
import type { Pairing, Pairings } from './pairings.ts';
import { pairings } from './pairings.ts';
import type { DaemonStash, StoreInternals } from './store-state.ts';

// The steps daemon-switch.ts is made of (ADR 0037): letting the open daemon go and opening
// another, queueing those changes one after another, and keeping the picker's list and the
// record of which daemon was open last up to date. Apart only to keep each file small.

const serial = <T>(i: StoreInternals, change: () => Promise<T>): Promise<T> => {
  const run = i.serial.then(change, change);
  i.serial = run.catch(() => null);
  return run;
};

const publish = (i: StoreInternals, saved: Pairings): void => {
  i.state.daemons = saved.entries.map((e) => ({ id: e.id, name: e.name }));
};

// Best effort: the record only says which daemon to open first next time.
const remember = (i: StoreInternals, id: string): void => {
  void pairings
    .update(i.options.storage, (current) => ({ ...current, active: id }))
    .catch(() => null);
};

// The composer's files and previews, and the thumbnails, of a daemon nobody will come back to.
const drop = (i: StoreInternals, kept: Pick<DaemonStash, 'composers' | 'thumbs'>): void => {
  for (const draft of Object.values(kept.composers)) {
    for (const entry of draft.attachments) {
      i.files.delete(entry.key);
      if (entry.preview !== null) URL.revokeObjectURL(entry.preview);
    }
  }
  for (const url of Object.values(kept.thumbs)) URL.revokeObjectURL(url);
};

// Forgets what a daemon not open now left in the stash.
const dropStash = (i: StoreInternals, id: string): void => {
  const stashed = i.stash.get(id);
  i.stash.delete(id);
  if (stashed !== undefined) drop(i, stashed);
};

// Everything on screen that came from the daemon's connection.
const blank = (i: StoreInternals): void => {
  const s = i.state;
  s.activeDaemon = null;
  s.unknownDevice = null;
  s.status = 'stopped';
  s.daemon = null;
  s.daemonVersion = null;
  s.home = null;
  s.update = { target: null, phase: null, failed: null };
  s.updateCheck = null;
  s.push = 'unavailable';
  s.sessions = [];
  s.agents = ['claude'];
  s.rateWindows = [];
  s.logs = {};
  s.drafts = {};
  s.composers = {};
  s.thumbs = {};
  s.devices = [];
  s.settings = null;
  s.skills = null;
  s.runner = { runs: [], activeRunId: null };
};

// Lets the open daemon go, synchronously, so nothing its connection says afterwards reaches the
// screens: `keep` writes its cache and stashes its drafts; without it both are dropped.
const leave = (i: StoreInternals, keep: boolean): void => {
  const pairing = i.pairing;
  i.link = null;
  i.connection?.stop();
  i.connection = null;
  i.sync = null;
  i.deviceId = null;
  i.vapidPublicKey = null;
  i.refreshing = null;
  if (keep) logCache.flushWrites(i);
  else logCache.cancelWrites(i);
  i.logs.clear();
  // A thumbnail still being fetched went with the connection; the next open fetches it again.
  i.thumbLoads.clear();
  const { drafts, composers, sessions, thumbs } = i.state;
  if (pairing !== null && keep) {
    i.stash.set(pairing.id, { drafts, composers, sessions, thumbs, thumbOwners: i.thumbOwners });
  } else drop(i, { composers, thumbs });
  i.thumbOwners = new Map();
  i.pairing = null;
  boxLink.clearError(i);
  blank(i);
};

const enter = (i: StoreInternals, entry: Pairing): void => {
  i.pairing = entry;
  i.state.activeDaemon = entry.id;
  const stashed = i.stash.get(entry.id);
  if (stashed === undefined) return;
  i.stash.delete(entry.id);
  i.state.drafts = stashed.drafts;
  i.state.composers = stashed.composers;
  i.state.sessions = stashed.sessions;
  i.state.thumbs = stashed.thumbs;
  i.thumbOwners = stashed.thumbOwners;
  // Fetched already: marked done, so the timeline does not fetch them over again.
  for (const id of Object.keys(stashed.thumbs)) i.thumbLoads.set(id, Promise.resolve());
};

// Connects to a paired daemon. A stored relay the connection refuses (plaintext off loopback)
// needs a new pairing link: with no other daemon paired the pair screen is where that starts,
// and with others the picker stays on screen to reach them.
const open = async (i: StoreInternals, entry: Pairing): Promise<void> => {
  enter(i, entry);
  const link = {};
  try {
    const box = await pairedBox.load(entry.box);
    if (box === null) throw new ClientError('bad_pairing', 'This pairing could not be read.');
    const connection = await createConnection({
      ...boxLink.options(i, link),
      relayUrl: box.record.relayUrl,
      keys: box.keys,
      boxPub: box.boxPub,
    });
    // Forgotten while its keys were read or its connection made (an Unpair tapped mid-switch,
    // which lets go at once): nothing is adopted, and what adoption already took is let go.
    if (i.pairing !== entry) return;
    await boxLink.adopt(i, connection, link);
    if (i.pairing !== entry) {
      leave(i, false);
      return;
    }
    i.deviceId = box.record.deviceId;
    i.state.phase = 'paired';
    connection.start();
  } catch (error) {
    boxLink.reportError(i, error, 'connection');
    i.state.phase = i.state.daemons.length > 1 ? 'paired' : 'unpaired';
  }
};

// `root` is the daemon whose push subscription is still on the root worker (sw.ts).
const pick = (saved: Pairings, wanted?: string): Pairing | undefined =>
  saved.entries.find((e) => e.id === wanted || (wanted === 'root' && e.rootPush)) ??
  saved.entries.find((e) => e.id === saved.active) ??
  saved.entries[0];

// How long Unpair waits for the daemon to answer before it counts it unreachable: the confirm
// stays up meanwhile, and a call's own timeout is far longer than an operator should wait.
const revokeWaitMs = 5000;

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const timer = setTimeout(fn, ms);
  return () => {
    clearTimeout(timer);
  };
};

// Whether the daemon forgot this device: it said so, or it had already (`not_paired`).
const revoke = async (
  i: StoreInternals,
  connection: Connection,
  deviceId: string,
): Promise<boolean> => {
  const schedule = i.options.schedule ?? defaultSchedule;
  const timer: { cancel: (() => void) | null } = { cancel: null };
  const late = new Promise<boolean>((resolve) => {
    timer.cancel = schedule(() => {
      resolve(false);
    }, revokeWaitMs);
  });
  const answered = connection.call('devices.remove', { deviceId }).then(
    () => true,
    (error: unknown) => error instanceof ClientError && error.code === 'not_paired',
  );
  try {
    return await Promise.race([answered, late]);
  } finally {
    timer.cancel?.();
  }
};

export const daemonState: {
  serial: typeof serial;
  publish: typeof publish;
  remember: typeof remember;
  leave: typeof leave;
  dropStash: typeof dropStash;
  enter: typeof enter;
  open: typeof open;
  pick: typeof pick;
  revoke: typeof revoke;
} = { serial, publish, remember, leave, dropStash, enter, open, pick, revoke };
