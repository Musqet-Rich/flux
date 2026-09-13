import type { SwitchKey } from '../store/store-state.ts';
import { enterKey } from './enter-key.ts';

// The keyboard's way between session tabs, under the device's choice (store/switch-key.ts):
// the chosen chord with → or ↓ steps to the next tab, with ← or ↑ to the one before, wrapping
// at the ends (SessionTabs). A chord is judged on keydown with its modifiers held exactly, so
// ⌃⌥⇧← is nobody's. A chord with a job in a text box is the box's while the focus is in one;
// which have one depends on the keyboard: on a Mac ⌥← is a word back, ⇧← a character
// selected, ⌘← the line's start, ⌘⇧← the line selected to its start and ⌥↑ the paragraph's,
// so from the composer only ⌃⌥ and ⌘⌥ switch; on a PC words are Ctrl's, so ⌥ (Alt) is free
// there too. A held key is one step, not a step a repeat (SessionTabs, which keeps the repeats
// from the browser too): each switch pushes a history entry and syncs a log. An IME's key, or
// one something else consumed, is left.

type Held = Readonly<{ meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }>;

interface Chord {
  // The modifiers held, with ⌘ on a Mac where `meta` is asked for and Ctrl elsewhere.
  held: (mac: boolean) => Held;
  vertical: boolean;
  // Whether the chord has no meaning in a text box on this keyboard, so it switches from the
  // composer too.
  free: (mac: boolean) => boolean;
}

const none: Held = { meta: false, ctrl: false, alt: false, shift: false };
const held = (mac: boolean, on: Partial<Held>): Held => {
  const keys = { ...none, ...on };
  return mac ? keys : { ...keys, meta: false, ctrl: keys.ctrl || keys.meta };
};

const always = (): boolean => true;
const never = (): boolean => false;
const onPc = (mac: boolean): boolean => !mac;

const chords: Record<Exclude<SwitchKey, 'off'>, Chord> = {
  ctrlAlt: { held: (mac) => held(mac, { ctrl: true, alt: true }), vertical: false, free: always },
  altUpDown: { held: (mac) => held(mac, { alt: true }), vertical: true, free: onPc },
  metaShift: {
    held: (mac) => held(mac, { meta: true, shift: true }),
    vertical: false,
    free: never,
  },
  alt: { held: (mac) => held(mac, { alt: true }), vertical: false, free: onPc },
  metaAlt: { held: (mac) => held(mac, { meta: true, alt: true }), vertical: false, free: always },
  meta: { held: (mac) => held(mac, { meta: true }), vertical: false, free: never },
  shift: { held: (mac) => held(mac, { shift: true }), vertical: false, free: never },
};

// The step an arrow asks for along the chord's axis, or 0 for another key.
const direction = (key: string, vertical: boolean): -1 | 0 | 1 => {
  if (key === (vertical ? 'ArrowDown' : 'ArrowRight')) return 1;
  return key === (vertical ? 'ArrowUp' : 'ArrowLeft') ? -1 : 0;
};

const inText = (target: EventTarget | null): boolean =>
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLInputElement ||
  (target instanceof HTMLElement && target.isContentEditable);

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
  const to = direction(event.key, chord.vertical);
  if (to === 0 || !matches(event, chord.held(mac))) return 0;
  if (!chord.free(mac) && inText(event.target)) return 0;
  return to;
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

// What the chord costs, for the picker's hint: the job it has elsewhere on this keyboard, or
// nothing.
const composers = (job: string): string =>
  `In the composer this ${job}, so there it stays the composer’s.`;
const hint = (name: SwitchKey, mac: boolean): string => {
  const hints: Record<SwitchKey, string> = {
    ctrlAlt: mac
      ? 'VoiceOver uses ⌃⌥ as its own key; with VoiceOver on, pick another chord.'
      : 'Some desktops use Ctrl+Alt+← → for workspaces or screen rotation, and take it first.',
    altUpDown: mac ? composers('moves by paragraph') : '',
    metaShift: composers(mac ? 'selects to the line’s start or end' : 'selects by word'),
    alt: mac ? composers('moves by word') : 'The browser’s Back and Forward give way.',
    metaAlt: mac
      ? 'Safari and Chrome switch browser tabs with this; the app asks for it first, but the browser may keep it.'
      : '',
    meta: mac
      ? `${composers('moves to the line’s start or end')} Elsewhere the browser’s Back gives way.`
      : composers('moves by word'),
    shift: composers('selects a character'),
    off: 'No keyboard shortcut between tabs.',
  };
  return hints[name];
};

export const switchChord: {
  apple: boolean;
  step: typeof step;
  offered: typeof offered;
  label: typeof label;
  hint: typeof hint;
} = { apple: enterKey.apple, step, offered, label, hint };
