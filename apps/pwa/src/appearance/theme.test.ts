import { expect, test } from 'vitest';

import type { Parsed, Refused, Theme } from './theme.ts';
import { theme } from './theme.ts';

// The theme a parse gave, or the reason it did not as a theme that will match nothing.
const themeOf = (parsed: Parsed | Refused): Theme =>
  parsed.ok ? parsed.theme : { name: `refused: ${parsed.reason}` };

const keysOf = (colours: object | undefined): string[] => Object.keys(colours ?? {});

const nord = {
  name: 'Nord',
  dark: { bg: '#2e3440', fg: '#eceff4', accent: '#88c0d0', 'accent-fg': '#2e3440' },
};

test('a theme parses from its JSON and copies back out the same', () => {
  const text = theme.stringify(nord);
  const parsed = theme.parse(text);
  expect(parsed).toEqual({ ok: true, theme: nord });
  expect(theme.stringify(themeOf(parsed))).toBe(text);
});

test('a copied theme lays its keys out in token order, whatever order they came in', () => {
  const parsed = themeOf(theme.parse('{"dark":{"warn":"#fff","bg":"#000"},"name":"x","light":{}}'));
  expect(Object.keys(parsed)).toEqual(['name', 'light', 'dark']);
  expect(keysOf(parsed.dark)).toEqual(['bg', 'warn']);
});

test('the default theme survives its own JSON', () => {
  expect(theme.parse(theme.stringify(theme.default))).toEqual({ ok: true, theme: theme.default });
});

const refused: [string, string, string][] = [
  ['not JSON', '{name', 'not JSON'],
  ['not an object', '"Nord"', 'a theme is an object: {"name": ..., "light": {...}, "dark": {...}}'],
  ['an array', '[]', 'a theme is an object: {"name": ..., "light": {...}, "dark": {...}}'],
  ['no name', '{"dark":{}}', 'name must be a word or two'],
  ['a blank name', '{"name":" "}', 'name must be a word or two'],
  ['a name nobody typed', `{"name":"${'x'.repeat(65)}"}`, 'name must be a word or two'],
  [
    'a key that is not part of a theme',
    '{"name":"x","dusk":{}}',
    'dusk is not part of a theme: name, light, dark',
  ],
  [
    'a scheme that is not an object',
    '{"name":"x","dark":"#000"}',
    'dark must be an object of colours',
  ],
  [
    'a misspelt token',
    '{"name":"x","dark":{"pannel":"#000"}}',
    'dark.pannel is not a token: bg, fg, muted, panel, panel-2, border, accent, accent-fg, danger, ok, warn, ansi',
  ],
  [
    'a named colour',
    '{"name":"x","light":{"bg":"white"}}',
    'light.bg is not a colour: a colour is #rgb, #rrggbb or #rrggbbaa',
  ],
  [
    'a four-digit hex',
    '{"name":"x","light":{"bg":"#ffff"}}',
    'light.bg is not a colour: a colour is #rgb, #rrggbb or #rrggbbaa',
  ],
  [
    'a colour with a property in it',
    '{"name":"x","light":{"bg":"#fff; color: red"}}',
    'light.bg is not a colour: a colour is #rgb, #rrggbb or #rrggbbaa',
  ],
  [
    'a short ANSI list',
    '{"name":"x","dark":{"ansi":["#000"]}}',
    'dark.ansi must list 16 colours, 0 to 15',
  ],
  [
    'an ANSI colour that is not one',
    `{"name":"x","dark":{"ansi":[${'"#000",'.repeat(15)}"black"]}}`,
    'dark.ansi[15] is not a colour: a colour is #rgb, #rrggbb or #rrggbbaa',
  ],
];

test.each(refused)('%s is refused whole, saying why', (_name, text, reason) => {
  expect(theme.parse(text)).toEqual({ ok: false, reason });
});

test('every hex form is a colour, upper or lower case', () => {
  const parsed = theme.parse(
    '{"name":"x","dark":{"bg":"#000","fg":"#FFFFFF","muted":"#8b93a1","panel":"#171a21ff"}}',
  );
  expect(parsed.ok).toBe(true);
});

test('a key nobody typed is cut short in the reason', () => {
  const parsed = theme.parse(`{"name":"x","dark":{"${'k'.repeat(100)}":"#fff"}}`);
  expect(parsed).toEqual({
    ok: false,
    reason: `dark.${'k'.repeat(32)}… is not a token: bg, fg, muted, panel, panel-2, border, accent, accent-fg, danger, ok, warn, ansi`,
  });
});

test('the name is trimmed', () => {
  expect(theme.fromValue({ name: '  Nord ' })).toEqual({ ok: true, theme: { name: 'Nord' } });
});

test('the properties a theme sets are a light-dark pair per token, the default filling in', () => {
  const css = theme.css(nord);
  expect(Object.keys(css)).toHaveLength(27);
  expect(css['--bg']).toBe('light-dark(#f5f6f8, #2e3440)');
  expect(css['--accent-fg']).toBe('light-dark(#ffffff, #2e3440)');
  expect(css['--muted']).toBe('light-dark(#5c6472, #8b93a1)');
  expect(css['--ansi-1']).toBe('light-dark(#b3283c, #f7768e)');
  expect(css['--ansi-15']).toBe('light-dark(#1a1d24, #ffffff)');
});

test('a theme with ANSI colours sets those in the pair', () => {
  const ansi = Array.from({ length: 16 }, (_, i) => `#${i.toString(16).repeat(6)}`);
  const css = theme.css({ name: 'x', light: { ansi } });
  expect(css['--ansi-0']).toBe('light-dark(#000000, #3b4048)');
  expect(css['--ansi-15']).toBe('light-dark(#ffffff, #ffffff)');
});
