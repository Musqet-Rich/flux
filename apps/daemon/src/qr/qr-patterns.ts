import type { Grid } from './qr-grid.ts';
import { qrGrid } from './qr-grid.ts';
import { qrFormat } from './qr-format.ts';
import { qrTables } from './qr-tables.ts';

// Function patterns and reserved areas (ISO/IEC 18004 § 7.3): finders with separators, timing,
// alignment, the dark module, version information, and the format-information slots that are
// filled per mask later. `reserved` marks every module data placement must skip.

export interface Patterns {
  modules: Grid;
  reserved: Grid;
}

const paint = (p: Patterns, row: number, col: number, dark: boolean): void => {
  qrGrid.set(p.modules, row, col, dark);
  qrGrid.set(p.reserved, row, col, true);
};

// A finder is a 7×7 ring pattern; the separator is the surrounding light border inside the
// symbol, so the painted square is 9×9 clipped to the symbol.
const finder = (p: Patterns, size: number, top: number, left: number): void => {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const row = top + r;
      const col = left + c;
      if (row < 0 || col < 0 || row >= size || col >= size) continue;
      const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      paint(p, row, col, ring <= 1 || ring === 3);
    }
  }
};

const alignment = (p: Patterns, centreRow: number, centreCol: number): void => {
  for (let r = -2; r <= 2; r += 1) {
    for (let c = -2; c <= 2; c += 1) {
      const ring = Math.max(Math.abs(r), Math.abs(c));
      paint(p, centreRow + r, centreCol + c, ring !== 1);
    }
  }
};

const alignments = (p: Patterns, version: number): void => {
  const centres = qrTables.alignment(version);
  const last = centres.length - 1;
  centres.forEach((row, i) => {
    centres.forEach((col, j) => {
      const onFinder = (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
      if (!onFinder) alignment(p, row, col);
    });
  });
};

const timing = (p: Patterns, size: number): void => {
  for (let i = 8; i < size - 8; i += 1) {
    paint(p, 6, i, i % 2 === 0);
    paint(p, i, 6, i % 2 === 0);
  }
};

// Format slots are reserved light now and written per mask; the dark module is fixed.
const formatAreas = (p: Patterns, size: number): void => {
  for (let i = 0; i <= 8; i += 1) {
    // (8, 6) and (6, 8) belong to the timing patterns already painted.
    if (i !== 6) {
      paint(p, 8, i, false);
      paint(p, i, 8, false);
    }
    if (i < 8) {
      paint(p, size - 1 - i, 8, false);
      paint(p, 8, size - 1 - i, false);
    }
  }
  paint(p, size - 8, 8, true);
};

const versionInfo = (p: Patterns, size: number, version: number): void => {
  if (version < 7) return;
  const bits = qrFormat.versionBits(version);
  for (let i = 0; i < 18; i += 1) {
    const dark = ((bits >> i) & 1) === 1;
    paint(p, size - 11 + (i % 3), Math.floor(i / 3), dark);
    paint(p, Math.floor(i / 3), size - 11 + (i % 3), dark);
  }
};

export const qrPatterns = (version: number): Patterns => {
  const size = qrTables.size(version);
  const p = { modules: qrGrid.create(size), reserved: qrGrid.create(size) };
  finder(p, size, 0, 0);
  finder(p, size, 0, size - 7);
  finder(p, size, size - 7, 0);
  alignments(p, version);
  timing(p, size);
  formatAreas(p, size);
  versionInfo(p, size, version);
  return p;
};
