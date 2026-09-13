import type { Fonts } from './fonts.ts';
import { fonts } from './fonts.ts';

// A theme (ADR 0030): one JSON object an operator copies out of Settings and pastes in on
// another device. It names itself and gives a `light` and a `dark` set of the eleven colour
// tokens in styles/base.css, each set optionally with the sixteen ANSI colours a command's
// output may name; whatever a theme leaves out keeps the default's value. Colours are hex only
// (`#rgb`, `#rrggbb`, `#rrggbbaa`): every palette in the wild is published that way, one
// pattern checks it without a browser, and a value that is not a colour cannot ride into the
// stylesheet. A theme that does not parse is refused whole, with a reason naming the key, not
// repaired: the operator is looking at the JSON when it fails and can fix it. The JSON also
// carries `fonts`, the family for text and for code, which on the device is a choice of its
// own beside the theme (fonts.ts, appearance.ts): a theme's colours and its fonts are one
// object for sharing and two controls in Settings.

const tokens = [
  'bg',
  'fg',
  'muted',
  'panel',
  'panel-2',
  'border',
  'accent',
  'accent-fg',
  'danger',
  'ok',
  'warn',
] as const;

export type Token = (typeof tokens)[number];

export interface SchemeColours extends Partial<Record<Token, string>> {
  // All sixteen or none: a command names them by number, so a partial list would leave
  // some numbers to the default and the two palettes would clash. The parser holds the
  // count; the type does not, so a theme written by hand in code is on its author.
  ansi?: readonly string[];
}

export interface Theme {
  name: string;
  light?: SchemeColours;
  dark?: SchemeColours;
  // Carried for sharing only: the choice in force is the device's own (appearance.ts).
  fonts?: Fonts;
}

export interface Parsed {
  ok: true;
  theme: Theme;
}

export interface Refused {
  ok: false;
  reason: string;
}

interface FullColours extends Record<Token, string> {
  ansi: readonly string[];
}

interface FullTheme extends Theme {
  light: FullColours;
  dark: FullColours;
}

// The default ANSI palette as light-dark pairs, the shape css() needs them in (a pair per
// number, so neither side can run short of the other); the default theme reads them by side.
const defaultAnsi: readonly (readonly [light: string, dark: string])[] = [
  ['#2e3440', '#3b4048'],
  ['#b3283c', '#f7768e'],
  ['#3f7a1a', '#9ece6a'],
  ['#976800', '#e0af68'],
  ['#2b5fb4', '#7aa2f7'],
  ['#7a45b3', '#bb9af7'],
  ['#0e7490', '#7dcfff'],
  ['#6a717f', '#c0caf5'],
  ['#5b6373', '#565f89'],
  ['#cd394c', '#ff9eb1'],
  ['#437f1f', '#b9f27c'],
  ['#946909', '#f0c987'],
  ['#386ecb', '#9db9ff'],
  ['#8958c4', '#d2bbff'],
  ['#127a92', '#a0e0ff'],
  ['#1a1d24', '#ffffff'],
];

// Exactly the values in styles/base.css, which is what paints until this runs; the two must
// agree or choosing Default in Settings changes something, and .github/scripts/
// check-theme-default.sh, run by `pnpm run check`, refuses a pair that differs. Copied out of
// Settings, this is the template a new theme starts from.
const defaultTheme: FullTheme = {
  name: 'Default',
  light: {
    bg: '#f5f6f8',
    fg: '#1a1d24',
    muted: '#5c6472',
    panel: '#ffffff',
    'panel-2': '#e9ecf1',
    border: '#d3d8e0',
    accent: '#2a63c4',
    'accent-fg': '#ffffff',
    danger: '#c53333',
    ok: '#1a7a4c',
    warn: '#9a5b00',
    ansi: defaultAnsi.map(([light]) => light),
  },
  dark: {
    bg: '#0f1115',
    fg: '#e8eaf0',
    muted: '#8b93a1',
    panel: '#171a21',
    'panel-2': '#1f2430',
    border: '#2a2f3a',
    accent: '#4f8cff',
    'accent-fg': '#ffffff',
    danger: '#ff5f5f',
    ok: '#3fbf7f',
    warn: '#ffb347',
    ansi: defaultAnsi.map(([, dark]) => dark),
  },
};

const schemes = ['light', 'dark'] as const;
// A name is what the picker shows; a paste is the one place a length nobody typed can come from.
const nameLength = 64;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);

const isToken = (key: string): key is Token => tokens.some((token) => token === key);

const isColour = (value: unknown): value is string =>
  typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.test(value);

const refused = (reason: string): Refused => ({ ok: false, reason });

// A key named in a reason is the operator's own text, shown on a status line: enough of it
// to find, not all of it.
const shown = (key: string): string => (key.length > 32 ? `${key.slice(0, 32)}…` : key);

const colourRule = 'a colour is #rgb, #rrggbb or #rrggbbaa';

const readAnsi = (at: string, value: unknown): { ansi: readonly string[] } | Refused => {
  if (!isList(value) || value.length !== defaultAnsi.length) {
    return refused(`${at} must list ${defaultAnsi.length} colours, 0 to 15`);
  }
  const ansi: string[] = [];
  for (const [i, colour] of value.entries()) {
    if (!isColour(colour)) return refused(`${at}[${i}] is not a colour: ${colourRule}`);
    ansi.push(colour);
  }
  return { ansi };
};

// One scheme's set, in token order whatever order the JSON had, so a copied theme is always
// laid out the same way. Every key must be one the app knows: a misspelt token silently
// ignored would be a theme that "does not work" with no way to see why.
const readColours = (at: string, value: unknown): { colours: SchemeColours } | Refused => {
  if (!isRecord(value)) return refused(`${at} must be an object of colours`);
  const given = new Map<Token, string>();
  let ansi: readonly string[] | undefined;
  for (const [key, colour] of Object.entries(value)) {
    if (key === 'ansi') {
      const read = readAnsi(`${at}.ansi`, colour);
      if ('reason' in read) return read;
      ({ ansi } = read);
    } else if (isToken(key)) {
      if (!isColour(colour)) return refused(`${at}.${key} is not a colour: ${colourRule}`);
      given.set(key, colour);
    } else {
      return refused(`${at}.${shown(key)} is not a token: ${tokens.join(', ')}, ansi`);
    }
  }
  const colours: SchemeColours = {};
  for (const token of tokens) {
    const colour = given.get(token);
    if (colour !== undefined) colours[token] = colour;
  }
  if (ansi !== undefined) colours.ansi = ansi;
  return { colours };
};

const keys = ['name', 'light', 'dark', 'fonts'];

// A theme from a value already parsed from JSON: what the device stored, or a preset.
const fromValue = (value: unknown): Parsed | Refused => {
  if (!isRecord(value)) {
    return refused('a theme is an object: {"name": ..., "light": {...}, "dark": {...}}');
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      return refused(`${shown(key)} is not part of a theme: ${keys.join(', ')}`);
    }
  }
  const name = typeof value['name'] === 'string' ? value['name'].trim() : '';
  if (name === '' || name.length > nameLength) return refused('name must be a word or two');
  const theme: Theme = { name };
  for (const scheme of schemes) {
    if (!(scheme in value)) continue;
    const read = readColours(scheme, value[scheme]);
    if ('reason' in read) return read;
    theme[scheme] = read.colours;
  }
  if ('fonts' in value) {
    const read = fonts.read(value['fonts']);
    if (!read.ok) return read;
    theme.fonts = read.fonts;
  }
  return { ok: true, theme };
};

// A theme from the text on the clipboard.
const parse = (text: string): Parsed | Refused => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return refused('not JSON');
  }
  return fromValue(value);
};

// The theme as the operator shares it: indented, in the fixed key order fromValue built, so
// two copies of one theme are the same text.
const stringify = (theme: Theme): string => JSON.stringify(theme, null, 2);

// The theme's colours alone, what a paste keeps as the theme once its fonts are taken out.
const colours = (theme: Theme): Theme => {
  const bare: Theme = { name: theme.name };
  for (const scheme of schemes) {
    const set = theme[scheme];
    if (set !== undefined) bare[scheme] = set;
  }
  return bare;
};

// The theme with the device's fonts folded in, what a copy shares; no key at all when neither
// family is chosen, so the JSON says only what was chosen.
const withFonts = (theme: Theme, chosen: Fonts): Theme => {
  const shared = colours(theme);
  if (fonts.parts.some((part) => chosen[part] !== undefined)) shared.fonts = chosen;
  return shared;
};

// The custom properties a theme sets on the root, each a `light-dark()` pair like the
// stylesheet's own, with the default's value wherever the theme said nothing: a pair needs
// both values, and a stylesheet cannot be asked for one side of its own. The fonts are the
// device's own choice and set apart (fonts.ts).
const css = (theme: Theme): Record<string, string> => {
  const light = theme.light ?? {};
  const dark = theme.dark ?? {};
  const properties: Record<string, string> = {};
  for (const token of tokens) {
    const l = light[token] ?? defaultTheme.light[token];
    const d = dark[token] ?? defaultTheme.dark[token];
    properties[`--${token}`] = `light-dark(${l}, ${d})`;
  }
  for (const [i, [l, d]] of defaultAnsi.entries()) {
    properties[`--ansi-${i}`] = `light-dark(${light.ansi?.[i] ?? l}, ${dark.ansi?.[i] ?? d})`;
  }
  return properties;
};

export const theme: {
  tokens: typeof tokens;
  default: Theme;
  fromValue: typeof fromValue;
  parse: typeof parse;
  stringify: typeof stringify;
  withFonts: typeof withFonts;
  colours: typeof colours;
  css: typeof css;
} = { tokens, default: defaultTheme, fromValue, parse, stringify, withFonts, colours, css };
