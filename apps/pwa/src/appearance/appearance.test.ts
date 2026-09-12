import { expect, test } from 'vitest';

import type { SyncStorage, SystemScheme } from './appearance.ts';
import { appearance } from './appearance.ts';
import { presets } from './presets.ts';

const { nord } = presets;

// Storage holding one value, and what it holds parsed.
const storageOf = (stored: string | null): SyncStorage & { parsed: () => unknown } => {
  let held = stored;
  return {
    getItem: () => held,
    setItem: (_key, value) => {
      held = value;
    },
    parsed: () => {
      const value: unknown = JSON.parse(String(held));
      return value;
    },
  };
};

// A system whose preference the test flips.
const systemOf = (dark: boolean): SystemScheme & { flip: (dark: boolean) => void } => {
  const listeners: ((dark: boolean) => void)[] = [];
  return {
    dark,
    onChange: (fn) => {
      listeners.push(fn);
    },
    flip: (next) => {
      for (const fn of listeners) fn(next);
    },
  };
};

test('nothing stored is the system scheme at the default size, and it follows the system', () => {
  const system = systemOf(true);
  const a = appearance.create(storageOf(null), system);
  expect(a.choices).toEqual({ mode: 'system', fontSize: 15, theme: null });
  expect(a.scheme.value).toBe('dark');
  system.flip(false);
  expect(a.scheme.value).toBe('light');
});

test('a chosen scheme ignores the system, and is kept', () => {
  const storage = storageOf(null);
  const system = systemOf(false);
  const a = appearance.create(storage, system);
  a.setMode('dark');
  expect(a.scheme.value).toBe('dark');
  system.flip(true);
  system.flip(false);
  expect(a.scheme.value).toBe('dark');
  expect(storage.parsed()).toEqual({ mode: 'dark', fontSize: 15 });
  a.setMode('system');
  expect(a.scheme.value).toBe('light');
});

test('a stored choice is read back', () => {
  const a = appearance.create(storageOf('{"mode":"light","fontSize":18}'), systemOf(true));
  expect(a.choices).toEqual({ mode: 'light', fontSize: 18, theme: null });
  expect(a.scheme.value).toBe('light');
});

// Default is stored as no `theme` at all, which is also what a device that chose a scheme
// before there were themes has stored: it keeps that choice through the upgrade.
test('a theme is kept, and the default is kept as no theme', () => {
  const storage = storageOf(null);
  const a = appearance.create(storage, systemOf(true));
  a.setTheme(nord);
  expect(a.choices.theme).toEqual(nord);
  expect(storage.parsed()).toEqual({ mode: 'system', fontSize: 15, theme: nord });
  const again = appearance.create(storage, systemOf(true));
  expect(again.choices.theme).toEqual(nord);
  again.setTheme(null);
  expect(storage.parsed()).toEqual({ mode: 'system', fontSize: 15 });
  // A `null` written by hand reads the same as no key.
  const byHand = appearance.create(
    storageOf('{"mode":"dark","fontSize":15,"theme":null}'),
    systemOf(true),
  );
  expect(byHand.choices).toEqual({ mode: 'dark', fontSize: 15, theme: null });
});

test('a size is kept only within the slider range, and in whole pixels', () => {
  const storage = storageOf(null);
  const a = appearance.create(storage, systemOf(true));
  a.setFontSize(22);
  expect(a.choices.fontSize).toBe(22);
  a.setFontSize(23);
  a.setFontSize(11);
  a.setFontSize(16.5);
  a.setFontSize(Number.NaN);
  expect(a.choices.fontSize).toBe(22);
  expect(storage.parsed()).toEqual({ mode: 'system', fontSize: 22 });
});

const stale: [string, string][] = [
  ['not JSON', '{mode'],
  ['not an object', '"dark"'],
  ['null', 'null'],
  ['an unknown mode', '{"mode":"sepia","fontSize":15}'],
  ['a size out of range', '{"mode":"dark","fontSize":40}'],
  ['a size that is not a number', '{"mode":"dark","fontSize":"15"}'],
  ['half the shape', '{"mode":"dark"}'],
  ['a theme that is not one', '{"mode":"dark","fontSize":15,"theme":{"dark":{}}}'],
  [
    'a theme with a bad colour',
    '{"mode":"dark","fontSize":15,"theme":{"name":"x","dark":{"bg":"red"}}}',
  ],
];

test.each(stale)('stored %s falls back to the defaults whole', (_name, stored) => {
  const a = appearance.create(storageOf(stored), systemOf(true));
  expect(a.choices).toEqual({ mode: 'system', fontSize: 15, theme: null });
});

// The reactive state writes through to the object it wraps, so the defaults must be handed
// out as copies or one instance's choices become the next one's start.
test('a fresh instance starts from the defaults whatever another chose', () => {
  const first = appearance.create(storageOf(null), systemOf(true));
  first.setMode('dark');
  first.setFontSize(22);
  first.setTheme(nord);
  const second = appearance.create(storageOf(null), systemOf(true));
  expect(second.choices).toEqual({ mode: 'system', fontSize: 15, theme: null });
});
