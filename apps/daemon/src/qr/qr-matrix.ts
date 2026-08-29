import { DaemonError } from '../daemon-error.ts';
import { qrCodewords } from './qr-codewords.ts';
import { qrFormat } from './qr-format.ts';
import type { Grid } from './qr-grid.ts';
import { qrMask } from './qr-mask.ts';
import { qrPatterns } from './qr-patterns.ts';
import { qrPlace } from './qr-place.ts';
import { qrTables } from './qr-tables.ts';

// A QR symbol for `text` as a square grid of modules (true = dark): byte mode, error
// correction level M (qr-tables.ts says why), the smallest version that fits, and the mask
// with the lowest penalty score. Pure; renderers turn the grid into output.

const chooseVersion = (length: number): number => {
  for (let version = 1; version <= qrTables.maxVersion; version += 1) {
    if (length <= qrTables.byteCapacity(version)) return version;
  }
  throw new DaemonError('internal', `${length} bytes exceed QR version ${qrTables.maxVersion}`);
};

export const qrMatrix = (text: string): Grid => {
  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length);
  const { modules, reserved } = qrPatterns(version);
  qrPlace.data(modules, reserved, qrCodewords(bytes, version));
  let best: { grid: Grid; score: number } | undefined;
  for (let mask = 0; mask < qrMask.count; mask += 1) {
    const grid = qrMask.apply(modules, reserved, mask);
    qrPlace.format(grid, qrFormat.bits(mask));
    const score = qrMask.penalty(grid);
    if (best === undefined || score < best.score) best = { grid, score };
  }
  if (best === undefined) throw new DaemonError('internal', 'no mask evaluated');
  return best.grid;
};
