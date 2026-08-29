import { DaemonError } from '../daemon-error.ts';
import { gf256 } from './gf256.ts';

// Reed–Solomon error correction codewords (ISO/IEC 18004 § 7.5.2). The generator polynomial for
// n codewords is the product of (x − 2^i) for i in 0..n−1, coefficients highest degree first.

const at = (list: Uint8Array | number[], index: number): number => {
  const entry = list[index];
  if (entry === undefined) throw new DaemonError('internal', `polynomial index ${index}`);
  return entry;
};

const generator = (count: number): number[] => {
  let poly = [1];
  for (let i = 0; i < count; i += 1) {
    const root = gf256.pow(i);
    const next = Array.from({ length: poly.length + 1 }, () => 0);
    for (let j = 0; j < poly.length; j += 1) {
      const coefficient = at(poly, j);
      next[j] = at(next, j) ^ coefficient;
      next[j + 1] = at(next, j + 1) ^ gf256.mul(coefficient, root);
    }
    poly = next;
  }
  return poly;
};

// The remainder of data·x^count divided by the generator: the `count` EC codewords of a block.
const remainder = (data: Uint8Array, count: number): Uint8Array => {
  const poly = generator(count);
  const out = new Uint8Array(count);
  for (const byte of data) {
    const lead = at(out, 0) ^ byte;
    out.copyWithin(0, 1);
    out[count - 1] = 0;
    // poly[0] is 1 (monic), so the term that folds into out[i] uses poly[i + 1].
    for (let i = 0; i < count; i += 1) out[i] = at(out, i) ^ gf256.mul(lead, at(poly, i + 1));
  }
  return out;
};

export const reedSolomon: { generator: typeof generator; remainder: typeof remainder } = {
  generator,
  remainder,
};
