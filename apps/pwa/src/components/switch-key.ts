import type { SwitchKey } from '../store/store-state.ts';
import { enterKey } from './enter-key.ts';

// The keyboard's way between session tabs, under the device's choice (store/switch-key.ts):
// the chosen chord with → or ↓ steps to the next tab, with ← or ↑ to the one before, wrapping
// at the ends (SessionTabs). A chord is judged on keydown with its modifiers held exactly, so
// ⌃⌥⇧← is nobody's. A chord with a job in a text box (⌥← a word back, ⇧← a character
// selected, ⌘← the line's start, ⌘⇧← the line selected, ⌥↑ the paragraph's start) is the
// box's while the focus is in one: from the composer only ⌃⌥ and ⌘⌥ switch. Held, it repeats,
// a tab a repeat, like an arrow key. An IME's key, or one something else consumed, is left.

type Held = Readonly<{ meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }>;

interface Chord {
  // The modifiers held, with ⌘ on a Mac where `meta` is asked for and Ctrl elsewhere.
  held: (mac: boolean) => Held;
  vertical: boolean;
  // Whether the chord has no meaning in a text box, so it switches from the composer too.
  free: boolean;
}

const none: Held = { meta: false, ctrl: false, alt: false, shift: false };
const held = (mac: boolean, on: Partial<Held>): Held => {
  const keys = { ...none, ...on };
  return mac ? keys : { ...keys, meta: false, ctrl: keys.ctrl || keys.meta };
};

const chords: Record<Exclude<SwitchKey, 'off'>, Chord> = {
  ctrlAlt: { held: (mac) => held(mac, { ctrl: true, alt: true }), vertical: false, free: true },
  altUpDown: { held: (mac) => held(mac, { alt: true }), vertical: true, free: false },
  metaShift: {
    held: (mac) => held(mac, { meta: true, shift: true }),
    vertical: false,
    free: false,
  },
  alt: { held: (mac) => held(mac, { alt: true }), vertical: false, free: false },
  metaAlt: { held: (mac) => held(mac, { meta: true, alt: true }), vertical: false, free: true },
  meta: { held: (mac) => held(mac, { meta: true }), vertical: false, free: false },
  shift: { held: (mac) => held(mac, { shift: true }), vertical: false, free: false },
};

const arrows = {
  horizontal: { ArrowLeft: -1, ArrowRight: 1 },
  vertical: { ArrowUp: -1, ArrowDown: 1 },
} as const;

const inText = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target instanceof HTMLTextAreaElement ||
    target instanceof HTMLInputElement ||
    target.isContentEditable);

const matches = (event: KeyboardEvent, keys: Held): boolean =>
  event.metaKey === keys.meta &&
  event.ctrlKey === keys.ctrl &&
  event.altKey === keys.alt &&
  event.shiftKey === keys.shift;

// The step a keydown asks for under `name`: 1 for the next tab, -1 for the one before, 0 for
// a key that is not the chord or not the app's to take.
const step = (name: SwitchKey, event: KeyboardEvent, mac: boolean): -1 | 0 | 1 => {
  if (name === 'off' || event.defaultPrevented || event.isComposing) return 0;
  const chord = chords[name];
  const axis = chord.vertical ? arrows.vertical : arrows.horizontal;
  const direction = Object.entries(axis).find(([key]) => key === event.key)?.[1];
  if (direction === undefined || !matches(event, chord.held(mac))) return 0;
  if (!chord.free && inText(event.target)) return 0;
  return direction;
};

// On a PC ⌘⌥ and ⌃⌥ are both Ctrl+Alt, so only one is offered there.
const offered = (mac: boolean): readonly SwitchKey[] =>
  mac
    ? ['ctrlAlt', 'altUpDown', 'metaShift', 'alt', 'metaAlt', 'meta', 'shift', 'off']
    : ['ctrlAlt', 'altUpDown', 'metaShift', 'alt', 'meta', 'shift', 'off'];

// The chord's name for a select, in the device's own keyboard's terms.
const label = (name: SwitchKey, mac: boolean): string => {
  const labels: Record<SwitchKey, string> = {
    ctrlAlt: mac ? '⌃⌥ ← →' : 'Ctrl+Alt+← →',
    altUpDown: mac ? '⌥ ↑ ↓' : 'Alt+↑ ↓',
    metaShift: mac ? '⌘⇧ ← →' : 'Ctrl+Shift+← →',
    alt: mac ? '⌥ ← →' : 'Alt+← →',
    metaAlt: mac ? '⌘⌥ ← →' : 'Ctrl+Alt+← →',
    meta: mac ? '⌘ ← →' : 'Ctrl+← →',
    shift: mac ? '⇧ ← →' : 'Shift+← →',
    off: 'Off',
  };
  return labels[name];
};

// What the chord costs, for the picker's hint: the job it has elsewhere, or nothing.
const hint = (name: SwitchKey, mac: boolean): string => {
  const hints: Record<SwitchKey, string> = {
    ctrlAlt: '',
    altUpDown: 'In the composer this moves by paragraph, so there it stays the composer’s.',
    metaShift: 'In the composer this selects to the line’s end, so there it stays the composer’s.',
    alt: 'In the composer this moves by word, so there it stays the composer’s.',
    metaAlt: mac
      ? 'Safari and Chrome switch browser tabs with this; the app takes it while it has the focus.'
      : '',
    meta: mac
      ? 'In the composer this moves to the line’s end, so there it stays the composer’s; elsewhere the browser’s Back gives way.'
      : 'In the composer this moves by word, so there it stays the composer’s.',
    shift: 'In the composer this selects a character, so there it stays the composer’s.',
    off: 'No keyboard shortcut between tabs.',
  };
  return hints[name];
};

export const switchKey: {
  apple: boolean;
  step: typeof step;
  offered: typeof offered;
  label: typeof label;
  hint: typeof hint;
} = { apple: enterKey.apple, step, offered, label, hint };
