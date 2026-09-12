import { expect, test } from 'vitest';

import { presets } from './presets.ts';
import type { SchemeColours } from './theme.ts';
import { theme } from './theme.ts';

const keysOf = (colours: SchemeColours | undefined): string[] => Object.keys(colours ?? {});

// A preset is a theme like any pasted one, and a full one: copied out, it is the whole format.
const all = Object.values(presets);

test.each(all.map((p) => [p.name, p] as const))('%s is a complete theme', (_name, preset) => {
  expect(theme.parse(theme.stringify(preset))).toEqual({ ok: true, theme: preset });
  for (const scheme of ['light', 'dark'] as const) {
    expect(keysOf(preset[scheme])).toEqual([...theme.tokens, 'ansi']);
  }
});

test('the presets and the default have names of their own', () => {
  const names = [theme.default, ...all].map((p) => p.name);
  expect(new Set(names).size).toBe(names.length);
});
