import type { FluxEvent } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';

import type { SoundName } from '../sound/notification-sounds.ts';
import { notificationSounds } from '../sound/notification-sounds.ts';
import type { StoreInternals } from './store-state.ts';

// A sound on this device when the box would push (architecture.md § Notifications), for the
// browsers where Web Push is flaky or absent (Safari, Firefox, anything not signed into
// Google). The device gets the same events over its socket that the box pushes from, so the
// choice of moment mirrors the daemon's notifier (apps/daemon/src/create-notifier.ts): an ask,
// a done or blocked notify, a session going idle after running, each subject to the box's
// "Notify me when" settings. The sound itself is this device's choice, kept in its own storage
// under `storageKey`; the box never learns it.

const storageKey = 'sound';

// Several of the trigger events land together (a `notify done` and the `session.state idle`
// that follows it within the second); one sound covers them.
const hushMs = 1500;

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const timer = setTimeout(fn, ms);
  return () => {
    clearTimeout(timer);
  };
};

// Reads the device's choice; run when the connection is adopted (box-link.ts), which is before
// the operator can reach Settings and before any event could ring.
const load = async (i: StoreInternals): Promise<void> => {
  const stored = await i.options.storage.get(storageKey).catch(() => null);
  if (notificationSounds.isName(stored)) i.state.sound = stored;
};

// Plays the current choice; the picker's Play button, and `set` so the operator hears what they
// picked. The tap is the gesture the browser wants before it lets the page make a sound.
const play = (i: StoreInternals): void => {
  if (i.state.sound !== 'none') i.options.playSound?.(i.state.sound);
};

// Applies at once and plays the choice.
const set = async (i: StoreInternals, name: SoundName): Promise<void> => {
  i.state.sound = name;
  play(i);
  await i.options.storage.set(storageKey, name);
};

// Whether this event is one the box would push, given its settings. Until the settings have
// been fetched every trigger counts, so a sound is never missed for want of a Settings visit;
// `afterConnect` fetches them when a sound is chosen.
const triggers = (i: StoreInternals, event: FluxEvent, wasRunning: boolean): boolean => {
  if (!fluxEvent.isKnown(event)) return false;
  const flux = i.state.settings?.flux;
  if (event.type === 'ask') return flux?.notifyOnAsk ?? true;
  if (event.type === 'notify')
    return event.payload.level !== 'info' && (flux?.notifyOnDone ?? true);
  if (event.type === 'session.state') {
    return event.payload.state === 'idle' && wasRunning && (flux?.notifyOnIdle ?? true);
  }
  return false;
};

// Called for every live event before the session list is patched, so `wasRunning` is the
// state the list held before this event.
const onEvent = (i: StoreInternals, event: FluxEvent, wasRunning: boolean): void => {
  if (i.state.sound === 'none' || i.soundHush !== null) return;
  if (!triggers(i, event, wasRunning)) return;
  i.options.playSound?.(i.state.sound);
  const schedule = i.options.schedule ?? defaultSchedule;
  i.soundHush = schedule(() => {
    i.soundHush = null;
  }, hushMs);
};

export const notificationSound: {
  storageKey: string;
  hushMs: number;
  load: typeof load;
  set: typeof set;
  play: typeof play;
  onEvent: typeof onEvent;
} = { storageKey, hushMs, load, set, play, onEvent };
