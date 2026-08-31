import { expect, test } from 'vitest';

import { helpLookup } from './help-lookup.ts';
import type { ManualSection } from './manual.ts';
import { manual } from './manual.ts';

const sample: ManualSection[] = [
  { title: 'Overview', body: 'a general intro about the whole tool' },
  { title: 'Widgets', keywords: ['gadget'], body: 'a widget spins' },
  { title: 'Sprockets', body: 'a sprocket mentions a widget in passing' },
];

test('no query returns the overview intro and lists every section title', () => {
  const out = helpLookup(manual);
  expect(out).toContain('Flux gives a coding agent its own computer');
  expect(out).toContain('Topics');
  for (const section of manual) expect(out).toContain(section.title);
});

test('a manual without an Overview section still lists its topics', () => {
  const out = helpLookup([{ title: 'Only', body: 'x' }]);
  expect(out).toContain('Topics');
  expect(out).toContain('Only');
});

test('a title match outranks a body-only match', () => {
  const out = helpLookup(sample, 'widget');
  expect(out.startsWith('# Widgets')).toBe(true);
  expect(out.indexOf('# Widgets')).toBeLessThan(out.indexOf('# Sprockets'));
});

test('a title match outranks a keyword match', () => {
  const rankManual: ManualSection[] = [
    { title: 'Alpha', keywords: ['beacon'], body: 'nothing relevant' },
    { title: 'Beacon', body: 'nothing relevant' },
  ];
  const out = helpLookup(rankManual, 'beacon');
  expect(out.indexOf('# Beacon')).toBeLessThan(out.indexOf('# Alpha'));
});

test('a keyword match is found even when the title and body do not contain the term', () => {
  const out = helpLookup(sample, 'gadget');
  expect(out).toContain('# Widgets');
  expect(out).not.toContain('# Sprockets');
});

test('matching is case-insensitive and matches on a shared prefix', () => {
  expect(helpLookup(sample, 'WIDGET').startsWith('# Widgets')).toBe(true);
  // A real-manual prefix query: `pair` finds the `Pairing a device` section.
  expect(helpLookup(manual, 'pair')).toContain('# Pairing a device');
});

test('an unknown term returns a graceful note and the list of topics, not empty', () => {
  const out = helpLookup(sample, 'zzznomatch');
  expect(out).toContain('Nothing in the manual matched "zzznomatch"');
  expect(out).toContain('Topics');
  expect(out).toContain('Overview');
});

test('at most three sections are returned for a broad query', () => {
  const broad: ManualSection[] = Array.from({ length: 5 }, (_, i) => ({
    title: `Section ${i}`,
    body: 'shared token here',
  }));
  const out = helpLookup(broad, 'shared');
  expect(out.match(/^# /gmu)).toHaveLength(3);
});
