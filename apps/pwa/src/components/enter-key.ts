import type { SendKey } from '../store/store-state.ts';

// What an Enter in a message box means under the device's "Send with" choice
// (store/send-key.ts): the chosen chord sends and every other Enter starts a new line. A bare
// or ⇧ Enter is the browser's: it is judged on the `insertLineBreak` it produces (`beforeinput`
// with an `inputType`: every engine since Firefox 87 in 2021, Safari and Chrome long before),
// which a phone's keyboard raises too, and when it is not the send it goes in natively, on the
// undo stack. An Enter that is part of composing (an IME taking its candidate) is left to the
// IME, whatever it inserts. A ⌘, Ctrl or ⌥ Enter the browser ignores, so those are judged on
// keydown and the line broken by hand when they are not the send. When the message cannot go
// (in flight, a file still uploading) the send chord breaks the line like any other, rather
// than being a dead key beside a disabled Send button; a blank box has no line to break, so
// there every Enter does nothing.

// The chord held for an Enter: null for another key, an Enter the IME is composing with, or
// more than one of the three modifier groups, ⌘ and Ctrl being one group.
const chord = (event: KeyboardEvent): SendKey | null => {
  if (event.key !== 'Enter' || event.isComposing) return null;
  const held: SendKey[] = [];
  if (event.metaKey || event.ctrlKey) held.push('meta');
  if (event.altKey) held.push('alt');
  if (event.shiftKey) held.push('shift');
  if (held.length > 1) return null;
  return held[0] ?? 'enter';
};

const blank = (box: HTMLTextAreaElement): boolean => box.value.trim() === '';

// Breaks the line at the caret, replacing any selection, for a chord the browser would not.
// `setRangeText` rather than the deprecated `execCommand`, so this insert is not on the undo
// stack and an undo after it goes no further back; the native path above is why that is
// confined to chords. The caret is placed by hand rather than with `'end'`, which the test DOM
// gets wrong; v-model listens for `input`.
const newline = (box: HTMLTextAreaElement): void => {
  const at = box.selectionStart + 1;
  box.setRangeText('\n', box.selectionStart, box.selectionEnd);
  box.setSelectionRange(at, at);
  box.dispatchEvent(new Event('input', { bubbles: true }));
};

// What the last Enter keydown to reach `keydown` was, for `lineBreak` to judge the line break
// that follows in the same keystroke: its chord, or `none` for an Enter that was dealt with
// there or left to an IME, so a break after one of those is never taken for a send. Null once
// the break has been judged or another key has gone down; an autocorrect committing under the
// same keystroke, just before its break, leaves it be. One slot serves every message box
// because a keydown and its `beforeinput` are back to back; a caller that swallows a keydown
// before calling `keydown` (the slash list, the history's arrows) also stops its break, so the
// slot is not consulted, and the next keydown to reach `keydown` clears it.
let pending: SendKey | 'none' | null = null;

// A keydown in `box`: true when the caller should send. A ⌘, Ctrl or ⌥ Enter is consumed here,
// one way or the other; a bare or ⇧ Enter is noted for its line break; anything else is left alone.
const keydown = (
  send: SendKey,
  ready: boolean,
  event: KeyboardEvent,
  box: HTMLTextAreaElement | null,
): boolean => {
  if (event.key !== 'Enter') {
    pending = null;
    return false;
  }
  const held = chord(event);
  if (held === 'enter' || held === 'shift') {
    pending = held;
    return false;
  }
  pending = 'none';
  if (event.isComposing) return false;
  event.preventDefault();
  if (ready && held === send) return true;
  if (box !== null && !blank(box)) newline(box);
  return false;
};

// A `beforeinput` in `box`: true when it is the line break of the send key and the message can
// go, in which case the break is cancelled and the caller sends; otherwise the break goes in
// natively, unless the box is blank. A break with no keydown before it (a phone keyboard's
// Enter, on some) counts as a bare Enter.
const lineBreak = (
  send: SendKey,
  ready: boolean,
  event: InputEvent,
  box: HTMLTextAreaElement | null,
): boolean => {
  if (event.inputType !== 'insertLineBreak') return false;
  const held = pending ?? 'enter';
  pending = null;
  if (box === null || blank(box)) {
    event.preventDefault();
    return false;
  }
  if (!ready || held !== send) return false;
  event.preventDefault();
  return true;
};

// Apple hardware has ⌘ and ⌥ where the rest have Ctrl and Alt.
const apple = /Mac|iPhone|iPad/u.test(navigator.userAgent);

// The chord's name for a select, in the device's own keyboard's terms.
const label = (name: SendKey, mac: boolean): string => {
  const chords: Record<SendKey, string> = {
    enter: 'Enter',
    meta: mac ? '⌘ Enter' : 'Ctrl+Enter',
    alt: mac ? '⌥ Enter' : 'Alt+Enter',
    shift: mac ? '⇧ Enter' : 'Shift+Enter',
  };
  return chords[name];
};

export const enterKey: {
  apple: boolean;
  chord: typeof chord;
  keydown: typeof keydown;
  lineBreak: typeof lineBreak;
  label: typeof label;
} = { apple, chord, keydown, lineBreak, label };
