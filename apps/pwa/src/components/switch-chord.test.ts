import { expect, test } from 'vitest';

import { switchChord } from './switch-chord.ts';

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
  expect(switchChord.step('ctrlAlt', key('ArrowRight', on), true)).toBe(1);
  expect(switchChord.step('ctrlAlt', key('ArrowLeft', on), false)).toBe(-1);
  expect(switchChord.step('ctrlAlt', key('ArrowRight', on, box), true)).toBe(1);
  expect(switchChord.step('ctrlAlt', key('ArrowRight', { ...on, shiftKey: true }), true)).toBe(0);
  expect(switchChord.step('ctrlAlt', key('ArrowRight', { altKey: true }), true)).toBe(0);
  expect(switchChord.step('ctrlAlt', key('ArrowUp', on), true)).toBe(0);
  expect(switchChord.step('ctrlAlt', key('a', on), true)).toBe(0);
});

test('a chord with a caret meaning yields to a text box; ⌘ is Ctrl on a PC; ⌥ ↑ ↓ is vertical', () => {
  expect(switchChord.step('alt', key('ArrowLeft', { altKey: true }), true)).toBe(-1);
  expect(switchChord.step('alt', key('ArrowLeft', { altKey: true }, box), true)).toBe(0);
  const input = document.createElement('input');
  expect(switchChord.step('shift', key('ArrowRight', { shiftKey: true }, input), true)).toBe(0);
  expect(switchChord.step('shift', key('ArrowRight', { shiftKey: true }), true)).toBe(1);
  expect(switchChord.step('meta', key('ArrowRight', { metaKey: true }), true)).toBe(1);
  expect(switchChord.step('meta', key('ArrowRight', { metaKey: true }), false)).toBe(0);
  expect(switchChord.step('meta', key('ArrowRight', { ctrlKey: true }), false)).toBe(1);
  expect(
    switchChord.step('metaAlt', key('ArrowRight', { ctrlKey: true, altKey: true }, box), false),
  ).toBe(1);
  expect(
    switchChord.step('metaShift', key('ArrowLeft', { metaKey: true, shiftKey: true }), true),
  ).toBe(-1);
  expect(switchChord.step('altUpDown', key('ArrowDown', { altKey: true }), true)).toBe(1);
  expect(switchChord.step('altUpDown', key('ArrowRight', { altKey: true }), true)).toBe(0);
});

test('on a PC, ⌥ is free in a text box and ⌘⇧ still yields', () => {
  expect(switchChord.step('alt', key('ArrowLeft', { altKey: true }, box), false)).toBe(-1);
  expect(switchChord.step('altUpDown', key('ArrowUp', { altKey: true }, box), false)).toBe(-1);
  const on = { ctrlKey: true, shiftKey: true };
  expect(switchChord.step('metaShift', key('ArrowLeft', on, box), false)).toBe(0);
  expect(switchChord.step('metaShift', key('ArrowLeft', on), false)).toBe(-1);
});

test('Off, a consumed key and a composing one take nothing; a repeat still matches', () => {
  const on = { ctrlKey: true, altKey: true };
  expect(switchChord.step('off', key('ArrowRight', on), true)).toBe(0);
  expect(switchChord.step('ctrlAlt', key('ArrowRight', { ...on, repeat: true }), true)).toBe(1);
  const taken = key('ArrowRight', on);
  taken.preventDefault();
  expect(switchChord.step('ctrlAlt', taken, true)).toBe(0);
  expect(switchChord.step('ctrlAlt', key('ArrowRight', { ...on, isComposing: true }), true)).toBe(
    0,
  );
});

test('labels and hints are in the keyboard’s terms, and a PC is offered one Ctrl+Alt only', () => {
  expect(switchChord.label('ctrlAlt', true)).toBe('⌃⌥ ← →');
  expect(switchChord.label('metaShift', false)).toBe('Ctrl+Shift+← →');
  expect(switchChord.label('altUpDown', true)).toBe('⌥ ↑ ↓');
  expect(switchChord.offered(true)).toContain('metaAlt');
  expect(switchChord.offered(false)).not.toContain('metaAlt');
  expect(switchChord.hint('ctrlAlt', true)).toContain('VoiceOver');
  expect(switchChord.hint('ctrlAlt', false)).toContain('workspaces');
  expect(switchChord.label('metaAlt', true)).toBe('⌘⌥ ← →');
  expect(switchChord.label('shift', false)).toBe('Shift+← →');
  expect(switchChord.label('off', true)).toBe('Off');
  expect(switchChord.hint('altUpDown', true)).toContain('paragraph');
  expect(switchChord.hint('shift', true)).toContain('character');
  expect(switchChord.hint('off', false)).toContain('No keyboard shortcut');
  expect(switchChord.hint('metaAlt', true)).toContain('browser tabs');
  expect(switchChord.hint('meta', true)).toContain('Back');
  expect(switchChord.hint('meta', false)).toContain('word');
  expect(switchChord.hint('alt', true)).toContain('word');
  expect(switchChord.hint('alt', false)).toContain('Back');
  expect(switchChord.hint('metaShift', false)).toContain('word');
  expect(switchChord.hint('altUpDown', false)).toBe('');
});
