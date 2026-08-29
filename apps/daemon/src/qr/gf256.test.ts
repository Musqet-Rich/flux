import { expect, test } from 'vitest';

import { gf256 } from './gf256.ts';

// Values from the QR field tables (ISO/IEC 18004 § 7.5.2; thonky.com/qr-code-tutorial
// "log antilog table"): 2^8 = 29 is the reduction by 0x11d, 2^254 = 142, log(3) = 25.
test('powers of the generator element follow the 0x11d reduction', () => {
  expect(gf256.pow(0)).toBe(1);
  expect(gf256.pow(1)).toBe(2);
  expect(gf256.pow(7)).toBe(128);
  expect(gf256.pow(8)).toBe(29);
  expect(gf256.pow(254)).toBe(142);
  expect(gf256.pow(255)).toBe(1);
});

test('multiplication is by log addition and zero annihilates', () => {
  expect(gf256.mul(3, 1)).toBe(3);
  expect(gf256.mul(2, 128)).toBe(29);
  expect(gf256.mul(0x53, 0xca)).toBe(143);
  expect(gf256.mul(0, 200)).toBe(0);
  expect(gf256.mul(200, 0)).toBe(0);
});

test('every non-zero element has an inverse', () => {
  const inverses = Array.from({ length: 255 }, (_, i) =>
    gf256.mul(gf256.pow(i), gf256.pow(255 - i)),
  );
  expect(new Set(inverses)).toEqual(new Set([1]));
});
