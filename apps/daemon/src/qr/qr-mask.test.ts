import { expect, test } from 'vitest';

import { qrGrid } from './qr-grid.ts';
import { qrMask } from './qr-mask.ts';

// Grids small enough to score by hand (ISO/IEC 18004 § 7.8.3). A checkerboard has no runs, no
// 2×2 blocks, no finder-like pattern and half its modules dark, so it scores 0 and is the base;
// every edit below is chosen so only the rule under test fires.
const checker = (size: number): boolean[][] =>
  Array.from({ length: size }, (_r, r) =>
    Array.from({ length: size }, (_c, c) => (r + c) % 2 === 0),
  );

const withRow = (size: number, row: number, pattern: string): boolean[][] => {
  const grid = checker(size);
  pattern.split('').forEach((ch, c) => {
    qrGrid.set(grid, row, c, ch === '1');
  });
  return grid;
};

const count = (grid: boolean[][]): number => grid.flat().filter(Boolean).length;

const transpose = (grid: boolean[][]): boolean[][] =>
  grid.map((_row, r) => grid.map((_col, c) => qrGrid.get(grid, c, r)));

test('a checkerboard scores zero', () => {
  expect(qrMask.penalty(checker(12))).toBe(0);
});

test('N1: a run of five scores 3 and each extra module adds 1', () => {
  expect(qrMask.penalty(withRow(12, 2, '111110101010'))).toBe(3);
  expect(qrMask.penalty(withRow(12, 2, '111111101010'))).toBe(5);
});

test('N2: one 2×2 block of one colour scores 3', () => {
  const grid = checker(12);
  qrGrid.set(grid, 0, 1, true);
  qrGrid.set(grid, 1, 0, true);
  expect(qrMask.penalty(grid)).toBe(3);
});

test('N3: a finder-like pattern with four light modules on one side scores 40', () => {
  // Row 5 of a 21-wide checkerboard, pattern then the checkerboard's own tail, keeps the dark
  // count and every run under five.
  const grid = withRow(21, 5, '101110100001010101010');
  expect(qrMask.penalty(grid)).toBe(40);
  expect(qrMask.penalty(transpose(grid))).toBe(40);
});

test('N3: light modules on both sides count twice', () => {
  expect(qrMask.penalty(withRow(21, 4, '100001011101000001010'))).toBe(80 + 3);
});

test('N4: the dark proportion scores 10 per full 5% step from 50%', () => {
  // 20 × 20 = 400 modules. Light modules at (1 mod 4, 0 mod 4) are far enough apart that
  // darkening them creates no run of five and no 2×2 block: 219 dark is 54.75%, 220 is 55%.
  const spots = [1, 5, 9, 13, 17].flatMap((r) => [0, 4, 8, 12, 16].map((c) => ({ r, c })));
  const fill = (dark: number): boolean[][] => {
    const grid = checker(20);
    spots.slice(0, dark - 200).forEach((spot) => {
      qrGrid.set(grid, spot.r, spot.c, true);
    });
    return grid;
  };
  expect(count(fill(220))).toBe(220);
  expect(qrMask.penalty(fill(219))).toBe(0);
  expect(qrMask.penalty(fill(220))).toBe(10);
});

test('an unknown mask is refused', () => {
  const grid = checker(4);
  expect(() => qrMask.apply(grid, grid, 8)).toThrow('no QR mask 8');
});
