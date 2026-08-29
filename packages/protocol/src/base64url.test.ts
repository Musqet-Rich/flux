import { expect, test } from 'vitest';

import { base64url } from './base64url.ts';
import { ProtocolError } from './protocol-error.ts';

// Vectors from RFC 4648 §10 with padding stripped and the URL alphabet applied.
const vectors: [number[], string][] = [
  [[], ''],
  [[0x66], 'Zg'],
  [[0x66, 0x6f], 'Zm8'],
  [[0x66, 0x6f, 0x6f], 'Zm9v'],
  [[0x66, 0x6f, 0x6f, 0x62], 'Zm9vYg'],
  [[0x66, 0x6f, 0x6f, 0x62, 0x61], 'Zm9vYmE'],
  [[0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72], 'Zm9vYmFy'],
  [[0xfb, 0xff, 0xbf], '-_-_'],
];

test.each(vectors)('encodes %j as %s', (input, expected) => {
  expect(base64url.encode(new Uint8Array(input))).toBe(expected);
});

test.each(vectors)('decodes %j back from %s', (expected, input) => {
  expect([...base64url.decode(input)]).toEqual(expected);
});

test('round-trips every byte value', () => {
  const all = new Uint8Array(256).map((_, i) => i);
  expect([...base64url.decode(base64url.encode(all))]).toEqual([...all]);
});

test('rejects characters outside the alphabet', () => {
  expect(() => base64url.decode('Zm9v+A')).toThrow(ProtocolError);
  expect(() => base64url.decode('Zm9vYg==')).toThrow(ProtocolError);
});

test('rejects an impossible length', () => {
  expect(() => base64url.decode('Z')).toThrow(ProtocolError);
  expect(() => base64url.decode('Zm9vY')).toThrow(ProtocolError);
});
