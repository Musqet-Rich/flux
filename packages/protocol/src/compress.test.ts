import { expect, test } from 'vitest';

import { bytes } from './bytes.ts';
import { compress } from './compress.ts';

test('round-trips and shrinks repetitive text', async () => {
  const text = bytes.fromUtf8('+const x = 1;\n'.repeat(200));
  const packed = await compress.deflate(text);
  expect(packed.length).toBeLessThan(text.length / 5);
  expect(await compress.inflate(packed)).toEqual(text);
});

test('round-trips empty input', async () => {
  const packed = await compress.deflate(new Uint8Array(0));
  expect(await compress.inflate(packed)).toEqual(new Uint8Array(0));
});

test('inflate rejects garbage', async () => {
  // Node rejects with an empty-message TypeError (code Z_DATA_ERROR); browsers differ in text.
  await expect(compress.inflate(new Uint8Array([1, 2, 3, 4, 5]))).rejects.toThrow(TypeError);
});
