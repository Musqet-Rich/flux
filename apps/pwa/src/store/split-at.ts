import type { StoreInternals } from './store-state.ts';

// Where the divider sits on a wide screen (ADR 0033): the chat's share of the width when a
// side pane is open, between `min` and `max` so neither pane can be dragged to nothing. The
// device's own, kept in its storage under `storageKey` like the send key and never sent to the
// box: a laptop and a monitor want different splits.

const min = 0.3;
const max = 0.7;
const initial = 0.5;
// One keyboard step of the divider.
const step = 0.02;
const storageKey = 'splitAt';

const clamp = (at: number): number => Math.min(max, Math.max(min, at));

const isShare = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

// Reads the device's choice; run when the connection is adopted (box-link.ts), before a
// session screen is up.
const load = async (i: StoreInternals): Promise<void> => {
  const stored = await i.options.storage.get(storageKey).catch(() => null);
  if (isShare(stored)) i.state.splitAt = stored;
};

const set = async (i: StoreInternals, at: number): Promise<void> => {
  i.state.splitAt = clamp(at);
  await i.options.storage.set(storageKey, i.state.splitAt);
};

export const splitAt: {
  min: number;
  max: number;
  initial: number;
  step: number;
  storageKey: string;
  clamp: typeof clamp;
  load: typeof load;
  set: typeof set;
} = { min, max, initial, step, storageKey, clamp, load, set };
