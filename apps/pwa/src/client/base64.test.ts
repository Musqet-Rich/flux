import { expect, test } from 'vitest';

import { base64 } from './base64.ts';

test('round-trips bytes through the standard alphabet, slices included', () => {
  expect(base64.encode(new Uint8Array([]))).toBe('');
  expect(base64.encode(new Uint8Array([104, 105]))).toBe('aGk=');
  expect(base64.encode(new Uint8Array([0, 255, 128]))).toBe('AP+A');
  expect(base64.decode('aGk=')).toEqual(new Uint8Array([104, 105]));
  expect(base64.decode('AP+A')).toEqual(new Uint8Array([0, 255, 128]));
  const big = new Uint8Array(0x8000 * 3 + 7).map((_, i) => i % 251);
  expect(base64.decode(base64.encode(big))).toEqual(big);
  expect(base64.encode(big)).toHaveLength(Math.ceil(big.length / 3) * 4);
});
