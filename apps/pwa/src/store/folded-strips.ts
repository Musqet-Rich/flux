import type { StoreInternals } from './store-state.ts';

// The sessions whose agents strip is folded to one line on this device (components/AgentStrip).
// Open is the default, so only the folded are kept: a list of session ids under `storageKey`,
// most recently folded last, like the send key the device's own and never sent to the box, so a
// phone and a laptop fold the same session independently. A deleted session's id lingers
// harmlessly; the list keeps the newest `limit` so it cannot grow without end.

const storageKey = 'foldedStrips';
const limit = 200;

const isList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

// Reads the device's list; run when the connection is adopted (box-link.ts), before a session
// screen is up.
const load = async (i: StoreInternals): Promise<void> => {
  const stored = await i.options.storage.get(storageKey).catch(() => null);
  if (isList(stored)) i.state.foldedStrips = stored.slice(-limit);
};

const set = async (i: StoreInternals, session: string, folded: boolean): Promise<void> => {
  // Built and stored as a plain array: the state's is a reactive proxy, which storage cannot
  // clone.
  const rest = i.state.foldedStrips.filter((id) => id !== session);
  const next = folded ? [...rest, session].slice(-limit) : rest;
  i.state.foldedStrips = next;
  await i.options.storage.set(storageKey, next);
};

export const foldedStrips: {
  limit: number;
  storageKey: string;
  load: typeof load;
  set: typeof set;
} = { limit, storageKey, load, set };
