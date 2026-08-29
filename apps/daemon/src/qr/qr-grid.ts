import { DaemonError } from '../daemon-error.ts';

// A square boolean grid (true = dark) with bounds-checked access, so the rest of the encoder
// never has to reason about `undefined` from `noUncheckedIndexedAccess`.

export type Grid = boolean[][];

const create = (size: number, fill = false): Grid =>
  Array.from({ length: size }, () => Array.from({ length: size }, () => fill));

const get = (grid: Grid, row: number, col: number): boolean => {
  const entry = grid[row]?.[col];
  if (entry === undefined) throw new DaemonError('internal', `grid read (${row}, ${col})`);
  return entry;
};

const set = (grid: Grid, row: number, col: number, value: boolean): void => {
  const line = grid[row];
  if (line === undefined || col < 0 || col >= line.length) {
    throw new DaemonError('internal', `grid write (${row}, ${col})`);
  }
  line[col] = value;
};

const clone = (grid: Grid): Grid => grid.map((line) => [...line]);

export const qrGrid: {
  create: typeof create;
  get: typeof get;
  set: typeof set;
  clone: typeof clone;
} = { create, get, set, clone };
