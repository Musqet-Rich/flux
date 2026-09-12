import { beforeEach, expect, test } from 'vitest';

import { enterKey } from './enter-key.ts';

// The chord an Enter carries, what a keydown and the line break that follows it mean under
// each "Send with" choice, and the newline the message box inserts for the chords a browser
// ignores.

const enter = (init: KeyboardEventInit = {}): KeyboardEvent =>
  new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, ...init });

const lineBreak = (inputType = 'insertLineBreak'): InputEvent =>
  new InputEvent('beforeinput', { inputType, cancelable: true });

const textarea = (value: string, start: number, end: number): HTMLTextAreaElement => {
  const box = document.createElement('textarea');
  box.value = value;
  box.setSelectionRange(start, end);
  return box;
};

// The last-Enter slot is the module's; another key going down clears it, so no test reads
// what the one before left.
beforeEach(() => {
  enterKey.keydown('enter', true, new KeyboardEvent('keydown', { key: 'a' }), null);
});

test('an Enter is named by its one modifier; ⌘ and Ctrl are one; two groups or composing are nothing', () => {
  expect(enterKey.chord(enter())).toBe('enter');
  expect(enterKey.chord(enter({ metaKey: true }))).toBe('meta');
  expect(enterKey.chord(enter({ ctrlKey: true }))).toBe('meta');
  expect(enterKey.chord(enter({ metaKey: true, ctrlKey: true }))).toBe('meta');
  expect(enterKey.chord(enter({ altKey: true }))).toBe('alt');
  expect(enterKey.chord(enter({ shiftKey: true }))).toBe('shift');
  expect(enterKey.chord(enter({ metaKey: true, shiftKey: true }))).toBeNull();
  expect(enterKey.chord(new KeyboardEvent('keydown', { key: 'a' }))).toBeNull();
  expect(enterKey.chord(enter({ isComposing: true }))).toBeNull();
});

test('keydown: a ⌘/Ctrl/⌥ send chord sends when the message can go, else breaks the line like any other', () => {
  const box = textarea('ab', 1, 1);
  const inputs: string[] = [];
  box.addEventListener('input', () => {
    inputs.push(box.value);
  });
  const send = enter({ ctrlKey: true });
  expect(enterKey.keydown('meta', true, send, box)).toBe(true);
  expect(send.defaultPrevented).toBe(true);
  expect(box.value).toBe('ab');
  const alt = enter({ altKey: true });
  expect(enterKey.keydown('meta', true, alt, box)).toBe(false);
  expect(alt.defaultPrevented).toBe(true);
  expect(box.value).toBe('a\nb');
  expect(box.selectionStart).toBe(2);
  expect(inputs).toEqual(['a\nb']);
  const notReady = enter({ metaKey: true });
  expect(enterKey.keydown('meta', false, notReady, box)).toBe(false);
  expect(notReady.defaultPrevented).toBe(true);
  expect(box.value).toBe('a\n\nb');
  const both = enter({ metaKey: true, shiftKey: true });
  expect(enterKey.keydown('meta', true, both, box)).toBe(false);
  expect(both.defaultPrevented).toBe(true);
  expect(box.value).toBe('a\n\n\nb');
  expect(enterKey.keydown('alt', true, enter({ altKey: true }), box)).toBe(true);
  // A box that is not mounted yet still has the chord swallowed rather than a stray newline.
  const unmounted = enter({ ctrlKey: true });
  expect(enterKey.keydown('enter', true, unmounted, null)).toBe(false);
  expect(unmounted.defaultPrevented).toBe(true);
});

test('keydown: a bare or ⇧ Enter, a composing Enter and any other key are left to the browser', () => {
  // Left to the browser is not left to `lineBreak`: after a composing Enter no break is a send.
  const box = textarea('ab', 1, 1);
  for (const event of [
    enter(),
    enter({ shiftKey: true }),
    enter({ isComposing: true }),
    enter({ altKey: true, isComposing: true }),
    new KeyboardEvent('keydown', { key: 'a', metaKey: true, cancelable: true }),
  ]) {
    expect(enterKey.keydown('enter', true, event, box)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  }
  expect(box.value).toBe('ab');
  enterKey.keydown('enter', true, enter({ isComposing: true }), box);
  const composed = lineBreak();
  expect(enterKey.lineBreak('enter', true, composed, box)).toBe(false);
  expect(composed.defaultPrevented).toBe(false);
});

test('the newline replaces a selection and leaves the caret after it; a blank box gets none', () => {
  const box = textarea('abc', 0, 2);
  const inputs: string[] = [];
  box.addEventListener('input', () => {
    inputs.push(box.value);
  });
  expect(enterKey.keydown('meta', true, enter({ altKey: true }), box)).toBe(false);
  expect(box.value).toBe('\nc');
  expect(box.selectionStart).toBe(1);
  expect(box.selectionEnd).toBe(1);
  expect(inputs).toEqual(['\nc']);
  const blank = textarea(' ', 1, 1);
  const chord = enter({ metaKey: true });
  expect(enterKey.keydown('enter', true, chord, blank)).toBe(false);
  expect(chord.defaultPrevented).toBe(true);
  expect(blank.value).toBe(' ');
  // Nor does the browser's own break go into a blank box, whichever Enter it is.
  enterKey.keydown('meta', false, enter(), blank);
  const bare = lineBreak();
  expect(enterKey.lineBreak('meta', false, bare, blank)).toBe(false);
  expect(bare.defaultPrevented).toBe(true);
});

test('a line break sends for the send key of the keystroke it follows, only when the message can go', () => {
  const box = textarea('ab', 1, 1);
  // A bare Enter with Enter chosen: sent, and the break cancelled.
  enterKey.keydown('enter', true, enter(), box);
  const sent = lineBreak();
  expect(enterKey.lineBreak('enter', true, sent, box)).toBe(true);
  expect(sent.defaultPrevented).toBe(true);
  // ⇧ Enter with ⇧ chosen: the same. With Enter chosen: the browser's line break.
  enterKey.keydown('shift', true, enter({ shiftKey: true }), box);
  expect(enterKey.lineBreak('shift', true, lineBreak(), box)).toBe(true);
  enterKey.keydown('enter', true, enter({ shiftKey: true }), box);
  const shifted = lineBreak();
  expect(enterKey.lineBreak('enter', true, shifted, box)).toBe(false);
  expect(shifted.defaultPrevented).toBe(false);
  // The keystroke is taken once: a second break, or one with no keydown, is a bare Enter's.
  enterKey.keydown('shift', true, enter({ shiftKey: true }), box);
  enterKey.lineBreak('shift', true, lineBreak(), box);
  expect(enterKey.lineBreak('shift', true, lineBreak(), box)).toBe(false);
  expect(enterKey.lineBreak('enter', true, lineBreak(), box)).toBe(true);
  // A chord's keydown was the whole keystroke: a break after it is nobody's send. Another key
  // going down forgets the last Enter; an autocorrect committing just before the break does not.
  enterKey.keydown('enter', true, enter({ metaKey: true }), box);
  expect(enterKey.lineBreak('enter', true, lineBreak(), box)).toBe(false);
  enterKey.keydown('enter', true, enter({ shiftKey: true }), box);
  enterKey.keydown('enter', true, new KeyboardEvent('keydown', { key: 'a' }), box);
  expect(enterKey.lineBreak('enter', true, lineBreak(), box)).toBe(true);
  enterKey.keydown('shift', true, enter({ shiftKey: true }), box);
  enterKey.lineBreak('shift', true, lineBreak('insertReplacementText'), box);
  expect(enterKey.lineBreak('shift', true, lineBreak(), box)).toBe(true);
  // Not ready, another send key, or not a line break at all: the browser's.
  for (const [send, ready, event] of [
    ['enter', false, lineBreak()],
    ['meta', true, lineBreak()],
    ['enter', true, lineBreak('insertText')],
  ] as const) {
    enterKey.keydown(send, ready, enter(), box);
    expect(enterKey.lineBreak(send, ready, event, box)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  }
});

test('labels name the chord in the keyboard terms of the device', () => {
  expect(enterKey.label('enter', true)).toBe('Enter');
  expect(enterKey.label('meta', true)).toBe('⌘ Enter');
  expect(enterKey.label('alt', true)).toBe('⌥ Enter');
  expect(enterKey.label('shift', true)).toBe('⇧ Enter');
  expect(enterKey.label('meta', false)).toBe('Ctrl+Enter');
  expect(enterKey.label('alt', false)).toBe('Alt+Enter');
  expect(enterKey.label('shift', false)).toBe('Shift+Enter');
  // happy-dom's user agent is not Apple's.
  expect(enterKey.apple).toBe(false);
});
