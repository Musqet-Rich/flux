import { expect, test } from 'vitest';

import { escapeStack } from './escape-stack.ts';
import { focusChord } from './focus-chord.ts';

// ⌃⌥M asks for the message box, with the modifiers exact, by the key's name or its position,
// not from the box itself, not from a text box on a PC where the M came out as AltGr's µ, not
// under something open on top, not for an IME's key or a consumed one.

const press = (init: KeyboardEventInit): KeyboardEvent =>
  new KeyboardEvent('keydown', { ctrlKey: true, altKey: true, key: 'm', code: 'KeyM', ...init });

const onTop = (): void => {};
// What a browser reports when the layout has no name for the key.
const unnamed = 'Unidentified';

const box = document.createElement('textarea');
const other = document.createElement('input');
document.body.append(box, other);

const asks = (event: KeyboardEvent, mac = false): boolean => focusChord.matches(event, box, mac);

test('the chord is Ctrl+Alt with M, by name, by µ or by position, and no other modifier', () => {
  expect(asks(press({}))).toBe(true);
  expect(asks(press({ key: 'M' }))).toBe(true);
  expect(asks(press({ key: 'µ', code: '' }))).toBe(true);
  expect(asks(press({ key: unnamed, code: 'KeyM' }))).toBe(true);
  expect(asks(press({ key: 'n', code: 'KeyN' }))).toBe(false);
  expect(asks(press({ altKey: false }))).toBe(false);
  expect(asks(press({ ctrlKey: false }))).toBe(false);
  expect(asks(press({ shiftKey: true }))).toBe(false);
  expect(asks(press({ metaKey: true }))).toBe(false);
});

test('a consumed key, an IME key and one under something open are left', () => {
  const taken = press({ cancelable: true });
  taken.preventDefault();
  expect(asks(taken)).toBe(false);
  expect(asks(press({ isComposing: true }))).toBe(false);
  escapeStack.register(onTop);
  expect(asks(press({}))).toBe(false);
  escapeStack.unregister(onTop);
  expect(asks(press({}))).toBe(true);
});

test('from the box itself the key is left; from another field the focus moves', () => {
  box.focus();
  expect(asks(press({}))).toBe(false);
  other.focus();
  expect(asks(press({}))).toBe(true);
  other.blur();
});

test('on a PC a µ typed in a field is AltGr’s; on a Mac it is the chord from anywhere', () => {
  other.focus();
  expect(asks(press({ key: 'µ' }))).toBe(false);
  expect(asks(press({ key: 'µ' }), true)).toBe(true);
  other.blur();
  expect(asks(press({ key: 'µ' }))).toBe(true);
});

test('the label is in the keyboard’s terms', () => {
  expect(focusChord.label(true)).toBe('⌃⌥M');
  expect(focusChord.label(false)).toBe('Ctrl+Alt+M');
});
