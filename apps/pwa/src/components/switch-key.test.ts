import { expect, test } from 'vitest';

import { switchKey } from './switch-key.ts';

// The chord is judged on keydown with its modifiers held exactly, ⌘ standing for Ctrl on a
// PC; one with a job in a text box is the box's while the focus is there; an IME's key or one
// already consumed is left alone; Off takes nothing.

const key = (name: string, init: KeyboardEventInit = {}, target?: EventTarget): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: name, cancelable: true, ...init });
  if (target !== undefined) Object.defineProperty(event, 'target', { value: target });
  return event;
};

const box = document.createElement('textarea');

test('⌃⌥ ← → step either way, exactly held, from a text box too', () => {
  const on = { ctrlKey: true, altKey: true };
  expect(switchKey.step('ctrlAlt', key('ArrowRight', on), true)).toBe(1);
  expect(switchKey.step('ctrlAlt', key('ArrowLeft', on), false)).toBe(-1);
  expect(switchKey.step('ctrlAlt', key('ArrowRight', on, box), true)).toBe(1);
  expect(switchKey.step('ctrlAlt', key('ArrowRight', { ...on, shiftKey: true }), true)).toBe(0);
  expect(switchKey.step('ctrlAlt', key('ArrowRight', { altKey: true }), true)).toBe(0);
  expect(switchKey.step('ctrlAlt', key('ArrowUp', on), true)).toBe(0);
  expect(switchKey.step('ctrlAlt', key('a', on), true)).toBe(0);
});

test('a chord with a caret meaning yields to a text box; ⌘ is Ctrl on a PC; ⌥ ↑ ↓ is vertical', () => {
  expect(switchKey.step('alt', key('ArrowLeft', { altKey: true }), true)).toBe(-1);
  expect(switchKey.step('alt', key('ArrowLeft', { altKey: true }, box), true)).toBe(0);
  const input = document.createElement('input');
  expect(switchKey.step('shift', key('ArrowRight', { shiftKey: true }, input), true)).toBe(0);
  expect(switchKey.step('shift', key('ArrowRight', { shiftKey: true }), true)).toBe(1);
  expect(switchKey.step('meta', key('ArrowRight', { metaKey: true }), true)).toBe(1);
  expect(switchKey.step('meta', key('ArrowRight', { metaKey: true }), false)).toBe(0);
  expect(switchKey.step('meta', key('ArrowRight', { ctrlKey: true }), false)).toBe(1);
  expect(
    switchKey.step('metaAlt', key('ArrowRight', { ctrlKey: true, altKey: true }, box), false),
  ).toBe(1);
  expect(
    switchKey.step('metaShift', key('ArrowLeft', { metaKey: true, shiftKey: true }), true),
  ).toBe(-1);
  expect(switchKey.step('altUpDown', key('ArrowDown', { altKey: true }), true)).toBe(1);
  expect(switchKey.step('altUpDown', key('ArrowRight', { altKey: true }), true)).toBe(0);
});

test('Off, a consumed key and a composing one take nothing', () => {
  const on = { ctrlKey: true, altKey: true };
  expect(switchKey.step('off', key('ArrowRight', on), true)).toBe(0);
  const taken = key('ArrowRight', on);
  taken.preventDefault();
  expect(switchKey.step('ctrlAlt', taken, true)).toBe(0);
  expect(switchKey.step('ctrlAlt', key('ArrowRight', { ...on, isComposing: true }), true)).toBe(0);
});

test('labels and hints are in the keyboard’s terms, and a PC is offered one Ctrl+Alt only', () => {
  expect(switchKey.label('ctrlAlt', true)).toBe('⌃⌥ ← →');
  expect(switchKey.label('metaShift', false)).toBe('Ctrl+Shift+← →');
  expect(switchKey.label('altUpDown', true)).toBe('⌥ ↑ ↓');
  expect(switchKey.offered(true)).toContain('metaAlt');
  expect(switchKey.offered(false)).not.toContain('metaAlt');
  expect(switchKey.hint('ctrlAlt', true)).toBe('');
  expect(switchKey.hint('metaAlt', true)).toContain('browser tabs');
  expect(switchKey.hint('meta', true)).toContain('Back');
  expect(switchKey.hint('meta', false)).toContain('word');
});
