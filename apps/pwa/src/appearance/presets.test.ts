import { expect, test } from 'vitest';

import { presets } from './presets.ts';
import type { SchemeColours, Token } from './theme.ts';
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

// WCAG 2.2 relative luminance and contrast ratio, for the rule base.css states for its light
// side, which Candlelight holds on both; only Candlelight claims it on both sides, so the
// default's and the two derived light sides are not checked here.
// Six hex digits only: a `#rgb`, which the format allows, would read as NaN and pass every
// comparison below.
const channel = (hex: string, offset: number): number => {
  if (!/^#[0-9a-f]{6}$/iu.test(hex)) throw new Error(`not #rrggbb: ${hex}`);
  const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string): number =>
  0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
const contrast = (a: string, b: string): number => {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const { candlelight } = presets;
const schemes = ['light', 'dark'] as const;
const sideOf = (scheme: (typeof schemes)[number]): SchemeColours => candlelight[scheme] ?? {};
// A token the side lacks fails here, not silently as a NaN that no comparison catches.
const at = (side: SchemeColours, token: Token): string => {
  const colour = side[token];
  if (colour === undefined) throw new Error(`no ${token}`);
  return colour;
};
const coloursOf = (side: SchemeColours): string[] => [
  ...theme.tokens.map((token) => at(side, token)),
  ...(side.ansi ?? []),
];
const blueByte = (hex: string): number => Number.parseInt(hex.slice(5, 7), 16);
// The default's page and Solarized's are 0.92, and a white to the eye starts well below
// them: a paper stays under this, whatever its hue.
const white = 0.9;

const text: Token[] = ['fg', 'muted', 'accent', 'danger', 'ok', 'warn'];
const surfaces: Token[] = ['bg', 'panel', 'panel-2'];
// Every pairing below 4.5:1, named: text on the page and both panels, the accent's text on
// it, and each ANSI colour but the two blacks (on the dark side near the page by design) on
// the page.
interface Pair {
  name: string;
  colour: string;
  on: string;
}
const dim = (side: SchemeColours): string[] => {
  const pairs: Pair[] = [
    ...text.flatMap((token) =>
      surfaces.map((surface) => ({
        name: `${token} on ${surface}`,
        colour: at(side, token),
        on: at(side, surface),
      })),
    ),
    { name: 'accent-fg on accent', colour: at(side, 'accent-fg'), on: at(side, 'accent') },
    ...(side.ansi ?? []).flatMap((colour, index) =>
      index === 0 || index === 8 ? [] : [{ name: `ansi ${index}`, colour, on: at(side, 'bg') }],
    ),
  ];
  return pairs.filter((pair) => contrast(pair.colour, pair.on) < 4.5).map((pair) => pair.name);
};

test('Candlelight has no blue at night and no white by day', () => {
  expect(coloursOf(sideOf('dark')).filter((colour) => blueByte(colour) !== 0)).toEqual([]);
  expect(coloursOf(sideOf('light')).filter((colour) => luminance(colour) >= white)).toEqual([]);
});

test.each(schemes)('Candlelight %s reads at 4.5:1', (scheme) => {
  expect(dim(sideOf(scheme))).toEqual([]);
});
