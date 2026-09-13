import type { StoreInternals, SwitchKey } from './store-state.ts';

// Which chord moves between session tabs on this device; components/switch-key.ts reads the
// keys against it. Every arrow chord has a job somewhere, in the browser (⌘← is Back, ⌘⌥← the
// tab before) or in a text box (⌥← a word back, ⇧← a character selected), so the choice is
// the device's, kept in its own storage under `storageKey` like the send key and never sent
// to the box. ⌃⌥ is the default because it is the one chord free in both places on a Mac.

const names: readonly SwitchKey[] = [
  'ctrlAlt',
  'altUpDown',
  'metaShift',
  'alt',
  'metaAlt',
  'meta',
  'shift',
  'off',
];

const storageKey = 'switchKey';

const isName = (value: unknown): value is SwitchKey => names.some((name) => name === value);

// Reads the device's choice; run when the connection is adopted (box-link.ts), before the tab
// strip is on screen.
const load = async (i: StoreInternals): Promise<void> => {
  const stored = await i.options.storage.get(storageKey).catch(() => null);
  if (isName(stored)) i.state.switchKey = stored;
};

const set = async (i: StoreInternals, name: SwitchKey): Promise<void> => {
  i.state.switchKey = name;
  await i.options.storage.set(storageKey, name);
};

export const switchKey: {
  names: readonly SwitchKey[];
  storageKey: string;
  isName: typeof isName;
  load: typeof load;
  set: typeof set;
} = { names, storageKey, isName, load, set };
