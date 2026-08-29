import { expect, test } from 'vitest';

import { renderQr } from './render-qr.ts';

const grid = (rows: string[]): boolean[][] =>
  rows.map((row) => row.split('').map((ch) => ch === '#'));

test('two module rows become one line of half blocks inside a four-module quiet zone', () => {
  const out = renderQr(grid(['#.', '.#']));
  const lines = out.split('\n');
  // 2 + 8 rows → 5 lines; 2 + 8 columns → 10 characters each.
  expect(lines.length).toBe(5);
  expect(lines.map((line) => Array.from(line).length)).toEqual([10, 10, 10, 10, 10]);
  expect(lines[0]).toBe('██████████');
  expect(lines[1]).toBe('██████████');
  expect(lines[2]).toBe('████▄▀████');
  expect(lines[3]).toBe('██████████');
  expect(lines[4]).toBe('██████████');
});

test('an odd number of rows treats the missing bottom row as quiet zone', () => {
  const lines = renderQr(grid(['#'])).split('\n');
  expect(lines.length).toBe(5);
  expect(lines[2]).toBe('████▄████');
  expect(lines[4]).toBe('█████████');
});

test('a fully dark pair renders as a space', () => {
  const lines = renderQr(grid(['##', '##'])).split('\n');
  expect(lines[2]).toBe('████  ████');
});
