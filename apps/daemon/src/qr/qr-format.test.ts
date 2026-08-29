import { expect, test } from 'vitest';

import { qrFormat } from './qr-format.ts';

// 15-bit format information from the published table (ISO/IEC 18004 annex C, table C.1).
test('format bits for known (level, mask) pairs', () => {
  expect(qrFormat.bits(0, 'M')).toBe(0b101010000010010);
  expect(qrFormat.bits(1, 'M')).toBe(0b101000100100101);
  expect(qrFormat.bits(7, 'M')).toBe(0x4aa0);
  expect(qrFormat.bits(0, 'L')).toBe(0b111011111000100);
  expect(qrFormat.bits(0, 'Q')).toBe(0b011010101011111);
  expect(qrFormat.bits(0, 'H')).toBe(0b001011010001001);
});

test('level M is the default', () => {
  expect(qrFormat.bits(3)).toBe(qrFormat.bits(3, 'M'));
});

// 18-bit version information from the published table (ISO/IEC 18004 annex D, table D.1).
test('version bits for versions 7, 8 and 15', () => {
  expect(qrFormat.versionBits(7)).toBe(0x07c94);
  expect(qrFormat.versionBits(8)).toBe(0x085bc);
  expect(qrFormat.versionBits(15)).toBe(0x0f928);
});
