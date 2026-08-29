import type { Grid } from './qr-grid.ts';
import { qrGrid } from './qr-grid.ts';

// Data masking (ISO/IEC 18004 § 7.8): the eight mask conditions, applied to non-reserved
// modules only, and the four penalty rules that choose between them (N1..N4 = 3, 3, 40, 10).

const conditions: ((row: number, col: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

const apply = (modules: Grid, reserved: Grid, mask: number): Grid => {
  const condition = conditions[mask];
  const out = qrGrid.clone(modules);
  if (condition === undefined) return out;
  const size = modules.length;
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (!qrGrid.get(reserved, r, c) && condition(r, c)) {
        qrGrid.set(out, r, c, !qrGrid.get(modules, r, c));
      }
    }
  }
  return out;
};

// N1: runs of five or more same-coloured modules in a line score 3 plus one per extra module.
const runPenalty = (line: boolean[]): number => {
  let score = 0;
  let run = 0;
  let previous: boolean | undefined;
  for (const dark of line) {
    run = dark === previous ? run + 1 : 1;
    previous = dark;
    if (run === 5) score += 3;
    else if (run > 5) score += 1;
  }
  return score;
};

// N3: the finder-like 1:1:3:1:1 pattern with four light modules on either side scores 40.
const finderLikePenalty = (line: boolean[]): number => {
  const text = line.map((dark) => (dark ? '1' : '0')).join('');
  let score = 0;
  for (let i = 0; i + 11 <= text.length; i += 1) {
    const window = text.slice(i, i + 11);
    if (window === '10111010000' || window === '00001011101') score += 40;
  }
  return score;
};

const column = (grid: Grid, c: number): boolean[] => grid.map((_line, r) => qrGrid.get(grid, r, c));

// N2: every 2×2 block of one colour scores 3 (overlapping blocks count separately).
const blockPenalty = (grid: Grid): number => {
  let score = 0;
  for (let r = 0; r + 1 < grid.length; r += 1) {
    for (let c = 0; c + 1 < grid.length; c += 1) {
      const a = qrGrid.get(grid, r, c);
      if (
        a === qrGrid.get(grid, r, c + 1) &&
        a === qrGrid.get(grid, r + 1, c) &&
        a === qrGrid.get(grid, r + 1, c + 1)
      ) {
        score += 3;
      }
    }
  }
  return score;
};

// N4: 10 per 5% step the dark proportion sits away from 50%.
const balancePenalty = (grid: Grid): number => {
  const total = grid.length * grid.length;
  const dark = grid.reduce((sum, line) => sum + line.filter(Boolean).length, 0);
  const deviation = Math.abs((dark * 100) / total - 50);
  return Math.floor(deviation / 5) * 10;
};

const penalty = (grid: Grid): number => {
  let score = blockPenalty(grid) + balancePenalty(grid);
  for (let i = 0; i < grid.length; i += 1) {
    const row = grid[i] ?? [];
    const col = column(grid, i);
    score += runPenalty(row) + runPenalty(col) + finderLikePenalty(row) + finderLikePenalty(col);
  }
  return score;
};

export const qrMask: { count: number; apply: typeof apply; penalty: typeof penalty } = {
  count: conditions.length,
  apply,
  penalty,
};
