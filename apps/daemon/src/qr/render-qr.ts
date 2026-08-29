import type { Grid } from './qr-grid.ts';
import { qrGrid } from './qr-grid.ts';

// Terminal rendering with Unicode half blocks: one character per module column, two module
// rows per line, plus the four-module quiet zone the symbol needs. Light modules are drawn in
// the foreground colour and dark modules left as the background, which is right way up on the
// usual dark terminal; scanners accept the reversed image on a light one. Plain text, so it
// prints the same with NO_COLOR or when piped.

const quiet = 4;

const glyph = (topLight: boolean, bottomLight: boolean): string => {
  if (topLight && bottomLight) return '█';
  if (topLight) return '▀';
  if (bottomLight) return '▄';
  return ' ';
};

export const renderQr = (matrix: Grid): string => {
  const size = matrix.length;
  const total = size + quiet * 2;
  // Anything outside the symbol, including a missing final row, is quiet zone (light).
  const light = (row: number, col: number): boolean => {
    const r = row - quiet;
    const c = col - quiet;
    if (r < 0 || c < 0 || r >= size || c >= size) return true;
    return !qrGrid.get(matrix, r, c);
  };
  const lines: string[] = [];
  for (let row = 0; row < total; row += 2) {
    let line = '';
    for (let col = 0; col < total; col += 1) line += glyph(light(row, col), light(row + 1, col));
    lines.push(line);
  }
  return lines.join('\n');
};
