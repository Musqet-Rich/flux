import { expect, test } from 'vitest';

import { room } from './room.ts';

const boxPub = new Uint8Array(32).map((_, i) => i);
const hex = (data: Uint8Array): string =>
  [...data].map((b) => b.toString(16).padStart(2, '0')).join('');

test('sha256 matches the known vector for "abc"', async () => {
  const digest = await room.sha256(new TextEncoder().encode('abc'));
  // secrets-allow: FIPS 180-4 test vector
  expect(hex(digest)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'); // secrets-allow
});

test('hmacSha256 matches RFC 4231 test case 2', async () => {
  const mac = await room.hmacSha256(
    new TextEncoder().encode('Jefe'),
    new TextEncoder().encode('what do ya want for nothing?'),
  );
  // secrets-allow: RFC 4231 test case 2
  expect(hex(mac)).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'); // secrets-allow
});

test('id is 22 url-safe characters derived from boxPub', async () => {
  const id = await room.id(boxPub);
  expect(id).toHaveLength(22);
  expect(id).toMatch(/^[A-Za-z0-9_-]+$/u);
  expect(await room.id(boxPub)).toBe(id);
  expect(await room.id(new Uint8Array(32))).not.toBe(id);
});

test('token is deterministic per boxPub and differs from id', async () => {
  const token = await room.token(boxPub);
  expect(token).toHaveLength(43);
  expect(await room.token(boxPub)).toBe(token);
  expect(token).not.toBe(await room.id(boxPub));
  expect(await room.token(new Uint8Array(32))).not.toBe(token);
});

test('fingerprint is the first 8 bytes of sha256', async () => {
  const fp = await room.fingerprint(boxPub);
  const full = await room.sha256(boxPub);
  expect(fp).toEqual(full.slice(0, 8));
});
