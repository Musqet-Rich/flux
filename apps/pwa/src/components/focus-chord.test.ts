import { expect, test } from 'vitest';

import { escapeStack } from './escape-stack.ts';
import { focusChord } from './focus-chord.ts';

// ⌃⌥M asks for the message box, with the modifiers exact, by the key's name or its position,
// not from a text box, not under something open on top, not for an IME's key or a consumed one.

const press = (init: KeyboardEventInit): KeyboardEvent =>
  new KeyboardEvent('keydown', { ctrlKey: true, altKey: true, key: 'm', code: 'KeyM', ...init });

const onTop = (): void => {};
// What a browser reports when the layout has no name for the key.
const unnamed = 'Unidentified';

test('the chord is Ctrl+Alt with M, by name, by µ or by position, and no other modifier', () => {
  expect(focusChord.matches(press({}))).toBe(true);
  expect(focusChord.matches(press({ key: 'M' }))).toBe(true);
  expect(focusChord.matches(press({ key: 'µ', code: '' }))).toBe(true);
  expect(focusChord.matches(press({ key: unnamed, code: 'KeyM' }))).toBe(true);
  expect(focusChord.matches(press({ key: 'n', code: 'KeyN' }))).toBe(false);
  expect(focusChord.matches(press({ altKey: false }))).toBe(false);
  expect(focusChord.matches(press({ ctrlKey: false }))).toBe(false);
  expect(focusChord.matches(press({ shiftKey: true }))).toBe(false);
  expect(focusChord.matches(press({ metaKey: true }))).toBe(false);
});

test('a consumed key, an IME key and one under something open are left', () => {
  const taken = press({ cancelable: true });
  taken.preventDefault();
  expect(focusChord.matches(taken)).toBe(false);
  expect(focusChord.matches(press({ isComposing: true }))).toBe(false);
  escapeStack.register(onTop);
  expect(focusChord.matches(press({}))).toBe(false);
  escapeStack.unregister(onTop);
  expect(focusChord.matches(press({}))).toBe(true);
});

test('from a text box the key is the box’s', () => {
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  expect(document.activeElement).toBe(input);
  expect(focusChord.matches(press({}))).toBe(false);
  input.blur();
  expect(focusChord.matches(press({}))).toBe(true);
  input.remove();
});

test('the label is in the keyboard’s terms', () => {
  expect(focusChord.label(true)).toBe('⌃⌥M');
  expect(focusChord.label(false)).toBe('Ctrl+Alt+M');
});
