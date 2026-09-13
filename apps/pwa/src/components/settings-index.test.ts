import { expect, test } from 'vitest';

import { settingsIndex } from './settings-index.ts';

const { entries, search, isShown } = settingsIndex;

test('a blank query shows everything', () => {
  expect(search('')).toBeNull();
  expect(search('   ')).toBeNull();
});

test('a field match shows the field and its section heading, not its siblings', () => {
  expect(search('dark')).toEqual(new Set(['flux-mode', 'appearance']));
});

test('a section match shows the whole section', () => {
  const shown = search('appearance');
  expect(shown).toEqual(
    new Set([
      'appearance',
      'flux-mode',
      'flux-theme',
      'flux-font-text',
      'flux-font-code',
      'flux-font-size',
    ]),
  );
});

test('matching ignores case and needs every word', () => {
  expect(search('Code FONT')).toEqual(new Set(['flux-font-code', 'appearance']));
  expect(search('code font zebra')).toEqual(new Set());
});

test('a word from a hint or a synonym finds the field', () => {
  expect(search('newline')?.has('flux-send-key')).toBe(true);
  expect(search('CLAUDE.md')?.has('harness-config')).toBe(true);
});

test('a query is a prefix of a word, never a run of letters inside one', () => {
  expect(search('noti')).toEqual(new Set(['flux-sound', 'this-device', 'flux-notify', 'flux']));
  expect(search('ode')).toEqual(new Set());
  // `the` starts Theme but not "another", the pair hint's word.
  expect(search('the')?.has('flux-theme')).toBe(true);
  expect(search('the')?.has('devices-pair')).toBe(false);
});

test('a theme or a font is found by its own name', () => {
  expect(search('nord')).toEqual(new Set(['flux-theme', 'appearance']));
  expect(search('mono')?.has('flux-font-code')).toBe(true);
});

test('isShown answers everything for a blank search and the set otherwise', () => {
  expect(isShown(null, 'anything')).toBe(true);
  expect(isShown(new Set(['flux-mode']), 'flux-mode')).toBe(true);
  expect(isShown(new Set(['flux-mode']), 'flux-theme')).toBe(false);
});

test('every entry is unique, lower-case, and every field names a real section', () => {
  const ids = entries.map((e) => e.id);
  expect(new Set(ids).size).toBe(ids.length);
  const sections = entries.filter((e) => e.section === null).map((e) => e.id);
  const parents = entries.filter((e) => e.section !== null).map((e) => e.section);
  expect(sections).toEqual(expect.arrayContaining(parents));
  const terms = entries.flatMap((e) => e.terms);
  expect(terms).toEqual(terms.map((t) => t.toLowerCase()));
  expect(terms).not.toContain('');
});
