import { expect, test } from 'vitest';

import { base64url } from './base64url.ts';
import { pairing } from './pairing.ts';

const boxPub = new Uint8Array(32).map((_, i) => i);
const devPub = new Uint8Array(32).map((_, i) => 255 - i);
const secret = new Uint8Array(16).map((_, i) => i * 3);

test('url puts both parts in the fragment', () => {
  const u = pairing.url('https://relay.example', { boxPub, secret });
  expect(u).toBe(`https://relay.example/#${base64url.encode(boxPub)}.${base64url.encode(secret)}`);
  expect(new URL(u).hash.length).toBeGreaterThan(1);
});

test('parse round-trips with the leading #', () => {
  const fragment = new URL(pairing.url('https://r', { boxPub, secret })).hash;
  expect(pairing.parse(fragment)).toEqual({ boxPub, secret });
});

test('parse round-trips without the leading #', () => {
  const fragment = new URL(pairing.url('https://r', { boxPub, secret })).hash;
  expect(pairing.parse(fragment.slice(1))).toEqual({ boxPub, secret });
});

test.each([
  ['', 'empty'],
  ['#', 'bare hash'],
  ['abc', 'no dot'],
  ['a.b.c', 'too many parts'],
  ['Zm9v+A.Zm9v', 'bad base64'],
  [`${base64url.encode(boxPub.slice(1))}.${base64url.encode(secret)}`, 'short key'],
  [`${base64url.encode(boxPub)}.${base64url.encode(secret.slice(1))}`, 'short secret'],
])('parse rejects %s (%s)', (input) => {
  expect(pairing.parse(input)).toBeNull();
});

test('proof verifies only with the same secret and keys', async () => {
  const p = await pairing.proof(secret, devPub, boxPub);
  expect(p).toHaveLength(32);
  expect(await pairing.verify(secret, devPub, boxPub, p)).toBe(true);
  expect(await pairing.verify(secret, boxPub, devPub, p)).toBe(false);
  expect(await pairing.verify(new Uint8Array(16), devPub, boxPub, p)).toBe(false);
  expect(await pairing.verify(secret, devPub, boxPub, p.slice(1))).toBe(false);
});

test('secretLength is 16 bytes', () => {
  expect(pairing.secretLength).toBe(16);
});
