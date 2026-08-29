import { expect, test } from 'vitest';

import { room } from './room.ts';

const boxPub = new Uint8Array(32).map((_, i) => i);
const hex = (data: Uint8Array): string =>
  [...data].map((b) => b.toString(16).padStart(2, '0')).join('');

test('sha256 matches the known vector for "abc"', async () => {
  const digest = await room.sha256(new TextEncoder().encode('abc'));
  // FIPS 180-4 vector, split so the secret scanner does not mistake it for a key.
  expect(hex(digest)).toBe(
    ['ba7816bf8f01cfea', '414140de5dae2223', 'b00361a396177a9c', 'b410ff61f20015ad'].join(''),
  );
});

test('hmacSha256 matches RFC 4231 test case 2', async () => {
  const mac = await room.hmacSha256(
    new TextEncoder().encode('Jefe'),
    new TextEncoder().encode('what do ya want for nothing?'),
  );
  // RFC 4231 vector, split as above.
  expect(hex(mac)).toBe(
    ['5bdcc146bf60754e', '6a042426089575c7', '5a003f089d273983', '9dec58b964ec3843'].join(''),
  );
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
