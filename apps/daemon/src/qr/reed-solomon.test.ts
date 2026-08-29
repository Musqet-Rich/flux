import { expect, test } from 'vitest';

import { reedSolomon } from './reed-solomon.ts';

// Generator polynomials from the published tables (ISO/IEC 18004 annex A; thonky.com
// "generator polynomial tool"), written as integers rather than exponents of 2.
test('generator polynomial for 7 codewords', () => {
  expect(reedSolomon.generator(7)).toEqual([1, 127, 122, 154, 164, 11, 68, 117]);
});

test('generator polynomial for 10 codewords', () => {
  expect(reedSolomon.generator(10)).toEqual([1, 216, 194, 159, 111, 199, 94, 95, 113, 157, 193]);
});

test('generator polynomial for 16 codewords', () => {
  expect(reedSolomon.generator(16)).toEqual([
    1, 59, 13, 104, 189, 68, 209, 30, 8, 163, 65, 41, 229, 98, 50, 36, 59,
  ]);
});

// The worked 1-M "HELLO WORLD" example (thonky.com "error correction coding"): 16 data
// codewords in, 10 EC codewords out.
test('EC codewords for the thonky 1-M example', () => {
  const data = new Uint8Array([
    32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17,
  ]);
  expect([...reedSolomon.remainder(data, 10)]).toEqual([
    196, 35, 39, 119, 235, 215, 231, 226, 93, 23,
  ]);
});

test('the remainder of the generator itself is zero', () => {
  const data = new Uint8Array(reedSolomon.generator(7));
  expect([...reedSolomon.remainder(data, 7)]).toEqual([0, 0, 0, 0, 0, 0, 0]);
});
