import { DaemonError } from '../daemon-error.ts';

// Per-version constants for error correction level M, versions 1 to 15 (ISO/IEC 18004 tables 9
// and E.1). Level M: a pairing URL (~90 bytes) needs version 6 at M or 5 at L; the extra 4
// modules a side cost nothing in a terminal, and 15% recovery tolerates a terminal font that
// renders half-blocks with hairline gaps. Version 15 holds 412 bytes, four times a pairing URL.

export interface BlockGroup {
  count: number;
  dataCodewords: number;
}

export interface EcBlocks {
  ecPerBlock: number;
  groups: BlockGroup[];
}

const maxVersion = 15;

// [ecPerBlock, group1 count, group1 data codewords, group2 count, group2 data codewords]
const ecTable: number[][] = [
  [10, 1, 16],
  [16, 1, 28],
  [26, 1, 44],
  [18, 2, 32],
  [24, 2, 43],
  [16, 4, 27],
  [18, 4, 31],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
  [30, 1, 50, 4, 51],
  [22, 6, 36, 2, 37],
  [22, 8, 37, 1, 38],
  [24, 4, 40, 5, 41],
  [24, 5, 41, 5, 42],
];

// Alignment pattern centre coordinates; version 1 has none.
const alignmentTable: number[][] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
];

const row = <T>(table: T[], version: number): T => {
  const entry = table[version - 1];
  if (entry === undefined) throw new DaemonError('internal', `no QR version ${version}`);
  return entry;
};

const ecBlocks = (version: number): EcBlocks => {
  const [ecPerBlock, count1, data1, count2, data2] = row(ecTable, version);
  if (ecPerBlock === undefined || count1 === undefined || data1 === undefined) {
    throw new DaemonError('internal', `malformed EC row for version ${version}`);
  }
  const groups = [{ count: count1, dataCodewords: data1 }];
  if (count2 !== undefined && data2 !== undefined) {
    groups.push({ count: count2, dataCodewords: data2 });
  }
  return { ecPerBlock, groups };
};

const dataCodewords = (version: number): number =>
  ecBlocks(version).groups.reduce((sum, g) => sum + g.count * g.dataCodewords, 0);

const totalCodewords = (version: number): number => {
  const { ecPerBlock, groups } = ecBlocks(version);
  return groups.reduce((sum, g) => sum + g.count * (g.dataCodewords + ecPerBlock), 0);
};

// Byte mode character count indicator width (ISO/IEC 18004 table 3).
const countBits = (version: number): number => (version < 10 ? 8 : 16);

// Bytes that fit after the 4-bit mode indicator and the count indicator.
const byteCapacity = (version: number): number =>
  Math.floor((dataCodewords(version) * 8 - 4 - countBits(version)) / 8);

const size = (version: number): number => 17 + 4 * version;

const alignment = (version: number): number[] => row(alignmentTable, version);

export const qrTables: {
  maxVersion: number;
  ecBlocks: typeof ecBlocks;
  dataCodewords: typeof dataCodewords;
  totalCodewords: typeof totalCodewords;
  countBits: typeof countBits;
  byteCapacity: typeof byteCapacity;
  size: typeof size;
  alignment: typeof alignment;
} = {
  maxVersion,
  ecBlocks,
  dataCodewords,
  totalCodewords,
  countBits,
  byteCapacity,
  size,
  alignment,
};
