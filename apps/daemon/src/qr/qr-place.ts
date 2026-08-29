import type { Grid } from './qr-grid.ts';
import { qrGrid } from './qr-grid.ts';

// Placement of the two mask-dependent pieces (ISO/IEC 18004 § 7.7.3 and § 7.9): codeword bits
// zig-zag upward and downward in two-module columns from the right, skipping the vertical
// timing column; format bits go in the two slots around the finders.

const data = (modules: Grid, reserved: Grid, codewords: Uint8Array): void => {
  const size = modules.length;
  let bitIndex = 0;
  const nextBit = (): boolean => {
    // The remainder bits past the last codeword are light.
    const byte = codewords[bitIndex >> 3] ?? 0;
    const dark = ((byte >> (7 - (bitIndex & 7))) & 1) === 1;
    bitIndex += 1;
    return dark;
  };
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right -= 1;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (!qrGrid.get(reserved, row, col)) qrGrid.set(modules, row, col, nextBit());
      }
    }
    upward = !upward;
  }
};

const format = (modules: Grid, bits: number): void => {
  const size = modules.length;
  // i = 0 is the most significant bit, placed at (8, 0) and at the bottom of column 8.
  const bit = (i: number): boolean => ((bits >> (14 - i)) & 1) === 1;
  for (let i = 0; i < 15; i += 1) {
    if (i < 6) qrGrid.set(modules, 8, i, bit(i));
    else if (i < 8) qrGrid.set(modules, 8, i + 1, bit(i));
    else if (i === 8) qrGrid.set(modules, 7, 8, bit(i));
    else qrGrid.set(modules, 14 - i, 8, bit(i));

    if (i < 7) qrGrid.set(modules, size - 1 - i, 8, bit(i));
    else qrGrid.set(modules, 8, size - 15 + i, bit(i));
  }
};

export const qrPlace: { data: typeof data; format: typeof format } = { data, format };
