import { expect, test } from 'vitest';

import { qrGrid } from './qr-grid.ts';
import { qrPatterns } from './qr-patterns.ts';

const finderRows = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];

const block = (grid: boolean[][], top: number, left: number, size: number): string[] =>
  Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_c, c) => (qrGrid.get(grid, top + r, left + c) ? '1' : '0')).join(
      '',
    ),
  );

test('a version 1 symbol is 21 modules with three finders', () => {
  const { modules } = qrPatterns(1);
  expect(modules.length).toBe(21);
  expect(block(modules, 0, 0, 7)).toEqual(finderRows);
  expect(block(modules, 0, 14, 7)).toEqual(finderRows);
  expect(block(modules, 14, 0, 7)).toEqual(finderRows);
});

test('separators are light and the dark module is set', () => {
  const { modules } = qrPatterns(1);
  expect(block(modules, 7, 0, 1)).toEqual(['0']);
  expect(block(modules, 0, 7, 1)).toEqual(['0']);
  expect(block(modules, 13, 20, 1)).toEqual(['0']);
  expect(qrGrid.get(modules, 13, 8)).toBe(true);
});

test('timing patterns alternate between the finders', () => {
  const { modules, reserved } = qrPatterns(2);
  const row = Array.from({ length: 9 }, (_, i) => qrGrid.get(modules, 6, 8 + i));
  const col = Array.from({ length: 9 }, (_, i) => qrGrid.get(modules, 8 + i, 6));
  const expected = [true, false, true, false, true, false, true, false, true];
  expect(row).toEqual(expected);
  expect(col).toEqual(expected);
  expect(qrGrid.get(reserved, 6, 12)).toBe(true);
});

test('version 2 has one alignment pattern centred at (18, 18)', () => {
  const { modules } = qrPatterns(2);
  expect(block(modules, 16, 16, 5)).toEqual(['11111', '10001', '10101', '10001', '11111']);
});

test('version 7 carries version information in both corners', () => {
  const { modules, reserved } = qrPatterns(7);
  expect(modules.length).toBe(45);
  // 0x07C94, bit 0 first: rows 34..36 of columns 0..5 read column by column.
  const bits = Array.from({ length: 18 }, (_, i) =>
    Number(qrGrid.get(modules, 34 + (i % 3), Math.floor(i / 3))),
  );
  expect(bits.join('')).toBe('001010010011111000');
  expect(qrGrid.get(reserved, 0, 34)).toBe(true);
});

test('every module the data placement must skip is reserved', () => {
  const { reserved } = qrPatterns(1);
  const count = reserved.flat().filter(Boolean).length;
  // 3 finders with separators (64 each), 2 timing runs of 5, 31 format slots including the
  // dark module: 192 + 10 + 31.
  expect(count).toBe(233);
});
