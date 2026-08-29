import { expect, test } from 'vitest';

import { bytes } from './bytes.ts';

test('concat joins parts in order', () => {
  const out = bytes.concat(new Uint8Array([1, 2]), new Uint8Array([]), new Uint8Array([3]));
  expect([...out]).toEqual([1, 2, 3]);
});

test('equals compares content and length', () => {
  expect(bytes.equals(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
  expect(bytes.equals(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
  expect(bytes.equals(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
});

test('utf8 round-trips and rejects malformed input', () => {
  const text = 'héllo ✓';
  expect(bytes.toUtf8(bytes.fromUtf8(text))).toBe(text);
  expect(() => bytes.toUtf8(new Uint8Array([0xff]))).toThrow(TypeError);
});

test('random returns the requested length', () => {
  const a = bytes.random(16);
  const b = bytes.random(16);
  expect(a.length).toBe(16);
  expect(bytes.equals(a, b)).toBe(false);
});
