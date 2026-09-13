import { enterKey } from './enter-key.ts';
import { escapeStack } from './escape-stack.ts';
import { inText } from './in-text.ts';

// The keyboard's way to the message box: ⌃⌥M on a Mac, Ctrl+Alt+M on a PC, the modifiers of
// the default switch chord (switch-chord.ts) so the two are learnt as one, and off with it,
// since ⌃⌥ is VoiceOver's own key and Off in the switch picker is how a VoiceOver user keeps
// the keyboard theirs. Fixed otherwise: with ⌥ alone the M would type µ on a Mac, with ⇧ it
// is a capital, and a chord to reach the box is not worth a picker of its own. Judged with its
// modifiers held exactly, and on the key's name or its position, since ⌥ turns the M into µ
// on a Mac and a layout can put another letter on the key. From another field the focus
// moves, as anywhere else; not from the box itself, which has it, and not from a text box
// on a PC where the M came out as µ, since there Ctrl+Alt is AltGr and the µ is being typed
// (a German layout). Not while something is open on top (escape-stack.ts), nor for an IME's
// key or one something else consumed.

const isM = (event: KeyboardEvent): boolean =>
  event.code === 'KeyM' || event.key === 'm' || event.key === 'M' || event.key === 'µ';

const chord = (event: KeyboardEvent): boolean =>
  event.ctrlKey && event.altKey && !event.metaKey && !event.shiftKey;

// Whether a keydown asks for `box`, on a Mac or a PC keyboard.
const matches = (event: KeyboardEvent, box: HTMLTextAreaElement, mac: boolean): boolean => {
  if (event.defaultPrevented || event.isComposing || !isM(event) || !chord(event)) return false;
  if (escapeStack.open()) return false;
  const active = document.activeElement;
  if (active === box) return false;
  return mac || event.key !== 'µ' || !inText(active);
};

// The chord's name in the device keyboard's terms, for the manual and a tooltip.
const label = (mac: boolean): string => (mac ? '⌃⌥M' : 'Ctrl+Alt+M');

export const focusChord: { apple: boolean; matches: typeof matches; label: typeof label } = {
  apple: enterKey.apple,
  matches,
  label,
};
