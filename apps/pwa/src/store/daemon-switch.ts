import { ClientError } from '../client/client-error.ts';
import type { PairDeviceResult } from '../client/pair-device.ts';
import { pairDevice } from '../client/pair-device.ts';
import { pairedBox } from '../client/paired-box.ts';
import { boxLink } from './box-link.ts';
import { daemonState } from './daemon-state.ts';
import type { Pairing, Pairings } from './pairings.ts';
import { pairings } from './pairings.ts';
import type { StoreInternals } from './store-state.ts';

const { serial, publish, remember, leave, dropStash, enter, open, pick } = daemonState;

// Several daemons, one open at a time (ADR 0037). The store holds every pairing (pairings.ts)
// but opens one connection: boot opens the one used last, a switch lets the open one go and
// opens another, pairing adds one and opens it, and forgetting one (the operator's Unpair, or
// the box saying this device is no longer paired) opens the next or lands on the pair screen.
//
// Letting a daemon go keeps what is worth keeping: its cached logs stay in storage under its
// own prefix, and its unsent drafts, session list and thumbnails wait in `i.stash` for it to
// open again. Everything else its screens showed (settings, devices, the runner's scrollback)
// belongs to its connection and is fetched again. Forgetting a daemon throws all of it away,
// and its push subscription with it; the device's own preferences (device-choices.ts, the
// appearance) are never the daemon's and are never touched.
//
// The changes run one after another (`serial`), so a second tap on the picker, or a revocation
// arriving mid-switch, waits for the first to finish instead of interleaving with it.

// Opens `wanted` (a notification's daemon, App.vue) if it is paired, else the one used last.
const boot = (i: StoreInternals, wanted?: string): Promise<void> =>
  serial(i, async () => {
    let saved: Pairings;
    try {
      saved = await pairings.load(i.options.storage);
    } catch (error) {
      boxLink.reportError(i, error, 'connection');
      i.state.phase = 'unpaired';
      return;
    }
    publish(i, saved);
    const entry = pick(saved, wanted);
    if (entry === undefined) {
      i.state.phase = 'unpaired';
      return;
    }
    if (saved.active !== entry.id) remember(i, entry.id);
    await open(i, entry);
  });

const switchTo = (i: StoreInternals, id: string): Promise<boolean> =>
  serial(i, async () => {
    if (i.pairing?.id === id && i.connection !== null) return true;
    let saved: Pairings;
    try {
      saved = await pairings.load(i.options.storage);
    } catch (error) {
      boxLink.reportError(i, error);
      return false;
    }
    const entry = saved.entries.find((e) => e.id === id);
    if (entry === undefined) return false;
    publish(i, saved);
    leave(i, true);
    remember(i, id);
    await open(i, entry);
    return true;
  });

// The new pairing is written before it is adopted, so a device never shows a daemon it would
// not find again after a reload; a daemon paired again keeps its cache and its name.
const keepPairing = async (
  i: StoreInternals,
  id: string,
  box: PairDeviceResult['box'],
): Promise<Pairing> => {
  const saved = await pairings.update(i.options.storage, (current) => {
    const existing = current.entries.find((e) => e.id === id);
    const entry: Pairing = {
      id,
      name: existing?.name ?? null,
      cache: existing?.cache ?? pairings.cacheFor(current, id),
      rootPush: existing?.rootPush ?? false,
      box: box.record,
    };
    const others = current.entries.filter((e) => e.id !== id);
    return { active: id, entries: [...others, entry] };
  });
  publish(i, saved);
  const entry = saved.entries.find((e) => e.id === id);
  if (entry === undefined) throw new ClientError('internal', 'The pairing was not kept.');
  return entry;
};

const adoptPairing = (i: StoreInternals, result: PairDeviceResult, link: object): Promise<void> =>
  serial(i, async () => {
    const { box, connection } = result;
    let entry: Pairing;
    try {
      entry = await keepPairing(i, await pairings.idOf(box.boxPub), box);
    } catch (error) {
      connection.stop();
      throw error;
    }
    leave(i, true);
    enter(i, entry);
    await boxLink.adopt(i, connection, link);
    i.deviceId = box.record.deviceId;
    i.state.phase = 'paired';
  });

// A pairing that did not happen. The first pairing (or one from a link opened before anything
// was open) leaves the pair screen with the reason, or reopens a daemon already paired with the
// reason as a passing message; pairing another beside the open daemon only says why. A pairing
// the operator cancelled says nothing.
const failed = async (
  i: StoreInternals,
  error: unknown,
  first: boolean,
  cancelled: boolean,
): Promise<void> => {
  if (!first) {
    if (!cancelled) boxLink.reportError(i, error);
    return;
  }
  const saved = await pairings.load(i.options.storage).catch(() => null);
  const entry = saved === null ? undefined : pick(saved);
  if (saved === null || entry === undefined) {
    boxLink.reportError(i, error, 'connection');
    i.state.phase = 'unpaired';
    return;
  }
  await serial(i, async () => {
    publish(i, saved);
    leave(i, true);
    await open(i, entry);
  });
  boxLink.reportError(i, error);
};

// Pairs from a link's fragment and opens the new daemon. While another daemon is open (the
// "Pair another daemon" dialog) it stays open and on screen until the new one is paired; the
// pairing connection's callbacks are not live until it is adopted.
const pair = async (
  i: StoreInternals,
  relayUrl: string,
  fragment: string,
  signal?: AbortSignal,
): Promise<boolean> => {
  const first = i.state.phase !== 'paired';
  if (first) {
    i.state.phase = 'pairing';
    boxLink.clearError(i);
  }
  const link = {};
  const options = {
    ...boxLink.options(i, link),
    // Why a first pairing cannot get through (the box on another protocol version) is all the
    // pair screen has to show; beside an open daemon the dialog's own state says it is waiting
    // until the connection is adopted, and from then it reports like any open daemon's.
    onError: (error: ClientError) => {
      if (first || i.link === link) boxLink.reportError(i, error, 'connection');
    },
    relayUrl,
    fragment,
    ...(signal === undefined ? {} : { signal }),
  };
  try {
    await adoptPairing(i, await pairDevice(options), link);
  } catch (error) {
    await failed(i, error, first, signal?.aborted === true);
    return false;
  }
  const adopted = i.link;
  try {
    await boxLink.afterConnect(i);
  } catch (error) {
    boxLink.reportFor(i, adopted, error, 'connection');
  }
  return true;
};

// Takes a daemon's pairing, cache and push subscription out of storage and the browser. A write
// that fails leaves the pairing in storage (`stuck`): the other daemons are still read back to
// open the next, and the operator is told this one may return after a reload.
const wipe = async (
  i: StoreInternals,
  pairing: Pairing,
): Promise<{ saved: Pairings | null; stuck: boolean }> => {
  const { storage, forgetPush } = i.options;
  const without = (current: Pairings): Pairings => ({
    active: current.active === pairing.id ? null : current.active,
    entries: current.entries.filter((e) => e.id !== pairing.id),
  });
  let stuck = false;
  let saved: Pairings | null;
  try {
    saved = await pairings.update(storage, without);
  } catch {
    stuck = true;
    const current = await pairings.load(storage).catch(() => null);
    saved = current === null ? null : without(current);
  }
  await storage.clear(pairing.cache).catch(() => null);
  await storage.remove(pairedBox.storageKey).catch(() => null);
  await forgetPush?.(pairing.id).catch(() => null);
  if (pairing.rootPush) await forgetPush?.(null).catch(() => null);
  return { saved, stuck };
};

// Forgets a daemon here, the open one unless `target` names another (an Unpair whose daemon a
// switch let go meanwhile): its pairing, its cached logs, its drafts and its push subscription,
// then, if nothing else is open, opens the next paired daemon with `reason` as a passing
// message, or lands on the pair screen with it. The pairing from before ADR 0037 may also have
// left its old key and the root worker's subscription behind; they go too. The open daemon is
// cut off at once, so a second call (a revocation notice after the operator's own Unpair) finds
// nothing open and does nothing.
const forget = (
  i: StoreInternals,
  reason: string | null,
  target: Pairing | null = i.pairing,
): Promise<void> => {
  const pairing = target;
  if (pairing === null) return Promise.resolve();
  if (i.pairing?.id === pairing.id) leave(i, false);
  dropStash(i, pairing.id);
  return serial(i, async () => {
    // A switch queued before this step may have opened the daemon being forgotten again, so it
    // is closed before the wipe and cannot subscribe to push again behind it.
    if (i.pairing?.id === pairing.id) leave(i, false);
    const { saved, stuck } = await wipe(i, pairing);
    const stuckNote = `${pairing.name ?? 'The daemon'} could not be forgotten on this device and may be back after a reload.`;
    const shown = stuck ? `${reason ?? ''} ${stuckNote}`.trim() : reason;
    i.state.daemons = i.state.daemons.filter((d) => d.id !== pairing.id);
    // A pairing that completed in the meantime is open already, and stays the open one.
    if (i.pairing !== null) {
      if (shown !== null) boxLink.reportError(i, shown);
      return;
    }
    const next = saved === null ? undefined : pick(saved);
    if (saved === null || next === undefined) {
      i.state.phase = 'unpaired';
      if (shown !== null) boxLink.reportError(i, shown, 'connection');
      return;
    }
    publish(i, saved);
    remember(i, next.id);
    await open(i, next);
    if (shown !== null) boxLink.reportError(i, shown);
  });
};

// The operator's Unpair (Settings › This device): the box is asked to forget this device first,
// as Settings › Devices can, and the device forgets the daemon whatever the answer. Resolves to
// whether the box did forget it; when it could not be reached the message says the box will go
// on listing this device. The revocation notice the box sends after its answer is not heard: the
// link is cut before the call, and the open daemon is forgotten here.
const unpair = async (i: StoreInternals): Promise<boolean> => {
  const { pairing, connection, deviceId } = i;
  if (pairing === null) return false;
  const name = i.state.daemon ?? pairing.name ?? 'The daemon';
  let revoked = false;
  if (connection !== null && deviceId !== null && connection.status() === 'connected') {
    i.link = null;
    revoked = await daemonState.revoke(i, connection, deviceId);
  }
  const unreachable =
    `${name} could not be reached, so this device was only forgotten here. ` +
    `${name} will keep listing it until it is revoked from another device.`;
  // A switch that started as Unpair was tapped may have opened another daemon meanwhile; the
  // operator confirmed forgetting this one, so it is forgotten whichever is open now.
  await forget(i, revoked ? null : unreachable, pairing);
  return revoked;
};

export const daemonSwitch: {
  boot: typeof boot;
  switchTo: typeof switchTo;
  pair: typeof pair;
  forget: typeof forget;
  unpair: typeof unpair;
} = { boot, switchTo, pair, forget, unpair };
