import { enterKey } from './enter-key.ts';
import { escapeStack } from './escape-stack.ts';
import { inText } from './in-text.ts';

// The keyboard's way to the message box: ⌃⌥M on a Mac, Ctrl+Alt+M on a PC, the modifiers of
// the default switch chord (switch-chord.ts) so the two are learnt as one. Fixed rather than
// chosen: with ⌥ alone the M would type µ on a Mac, with ⇧ it is a capital, and a chord to
// reach the box is not worth a picker. Judged with its modifiers held exactly, and on the key's
// name or its position, since ⌥ turns the M into µ on a Mac and a layout can move it. Not from
// a text box: the focus is already where the chord goes, or in another box whose key it is,
// and on a German or French PC Ctrl+Alt+M is AltGr's µ. Not while something is open on top
// (escape-stack.ts), nor for an IME's key or one something else consumed.

const isM = (event: KeyboardEvent): boolean =>
  event.code === 'KeyM' || event.key === 'm' || event.key === 'M' || event.key === 'µ';

const chord = (event: KeyboardEvent): boolean =>
  event.ctrlKey && event.altKey && !event.metaKey && !event.shiftKey;

// Whether a keydown asks for the message box.
const matches = (event: KeyboardEvent): boolean =>
  !event.defaultPrevented &&
  !event.isComposing &&
  isM(event) &&
  chord(event) &&
  !escapeStack.open() &&
  !inText(document.activeElement);

// The chord's name in the device keyboard's terms, for the manual and a tooltip.
const label = (mac: boolean): string => (mac ? '⌃⌥M' : 'Ctrl+Alt+M');

export const focusChord: { apple: boolean; matches: typeof matches; label: typeof label } = {
  apple: enterKey.apple,
  matches,
  label,
};
