import type { SendKey, StoreInternals } from './store-state.ts';

// Which Enter sends a message on this device; components/enter-key.ts reads the keys against
// it. A laptop wants a chord so a bare Enter can break lines; a phone keyboard has no modifier
// keys, so its operator may want Enter alone. The choice is the device's, kept in its own
// storage under `storageKey` like the notification sound and never sent to the box. `meta` is
// ⌘ on a Mac and Ctrl elsewhere, and is the default because it is what the app always did.

const names: readonly SendKey[] = ['enter', 'meta', 'alt', 'shift'];

const storageKey = 'sendKey';

const isName = (value: unknown): value is SendKey => names.some((name) => name === value);

// Reads the device's choice; run when the connection is adopted (box-link.ts), before any
// message box is on screen.
const load = async (i: StoreInternals): Promise<void> => {
  const stored = await i.options.storage.get(storageKey).catch(() => null);
  if (isName(stored)) i.state.sendKey = stored;
};

const set = async (i: StoreInternals, name: SendKey): Promise<void> => {
  i.state.sendKey = name;
  await i.options.storage.set(storageKey, name);
};

export const sendKey: {
  names: readonly SendKey[];
  storageKey: string;
  isName: typeof isName;
  load: typeof load;
  set: typeof set;
} = { names, storageKey, isName, load, set };
