import { pairing } from '@flux/protocol';
import { expect, test } from 'vitest';

import { qrMatrix } from './qr-matrix.ts';
import { qrTables } from './qr-tables.ts';

// Captured from python-qrcode 8.x (an independent, widely deployed encoder):
//   QRCode(error_correction=ERROR_CORRECT_M, border=0)
//     .add_data(QRData(b'HELLO WORLD', mode=MODE_8BIT_BYTE), optimize=0)
// Version 1-M, byte mode forced (the library would otherwise pick alphanumeric), mask 4 by
// the penalty rules. Not hand-edited.
const helloWorld = [
  '#######.##..#.#######',
  '#.....#....#..#.....#',
  '#.###.#..#.#..#.###.#',
  '#.###.#.#..#..#.###.#',
  '#.###.#.###.#.#.###.#',
  '#.....#.#..#..#.....#',
  '#######.#.#.#.#######',
  '........#..##........',
  '#...#.######.#####..#',
  '...#....#.###....####',
  '..######..##.##.#..#.',
  '#####...##...#.......',
  '#####.#.#.#.#.##..##.',
  '........#.#.####.#.##',
  '#######.###.#.#.##.#.',
  '#.....#..#.###.##..##',
  '#.###.#.##.#.##...##.',
  '#.###.#..#..#...##.##',
  '#.###.#..###...###...',
  '#.....#....#.#.......',
  '#######.#########.#.#',
];

const text = (grid: boolean[][]): string[] =>
  grid.map((row) => row.map((dark) => (dark ? '#' : '.')).join(''));

test('"HELLO WORLD" matches the reference encoder module for module', () => {
  expect(text(qrMatrix('HELLO WORLD'))).toEqual(helloWorld);
});

test('the version grows with the byte length at the published capacities', () => {
  expect(qrTables.byteCapacity(1)).toBe(14);
  expect(qrTables.byteCapacity(5)).toBe(84);
  expect(qrTables.byteCapacity(6)).toBe(106);
  expect(qrTables.byteCapacity(15)).toBe(412);
  expect(qrMatrix('a'.repeat(14)).length).toBe(21);
  expect(qrMatrix('a'.repeat(15)).length).toBe(25);
  expect(qrMatrix('a'.repeat(84)).length).toBe(37);
  expect(qrMatrix('a'.repeat(85)).length).toBe(41);
  expect(qrMatrix('a'.repeat(412)).length).toBe(77);
});

test('text past version 15 is refused', () => {
  expect(() => qrMatrix('a'.repeat(413))).toThrow('exceed QR version 15');
});

test('a pairing URL fits version 6 (41 modules)', () => {
  const url = pairing.url('https://flux.example.com', {
    boxPub: new Uint8Array(32).fill(7),
    secret: new Uint8Array(pairing.secretLength).fill(9),
  });
  expect(url.length).toBeLessThanOrEqual(qrTables.byteCapacity(6));
  expect(qrMatrix(url).length).toBe(41);
});

test('non-ASCII text is encoded as UTF-8 bytes', () => {
  expect(qrMatrix('ünïcödé ✓').length).toBe(25);
});
