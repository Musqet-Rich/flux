import { expect, test } from 'vitest';

import { base64url } from './base64url.ts';
import { bytes } from './bytes.ts';
import { handshake } from './handshake.ts';
import { ProtocolError } from './protocol-error.ts';

// A minimal AES-GCM round trip proves two CryptoKeys hold the same secret without exporting them.
const sameKey = async (encryptWith: CryptoKey, decryptWith: CryptoKey): Promise<boolean> => {
  const iv = new Uint8Array(12);
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    encryptWith,
    new Uint8Array(3),
  );
  try {
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, decryptWith, sealed);
    return true;
  } catch {
    return false;
  }
};

const session = async () => {
  const boxStatic = await handshake.generateKeyPair(true);
  const devStatic = await handshake.generateKeyPair(true);
  const boxEph = await handshake.generateKeyPair();
  const devEph = await handshake.generateKeyPair();
  const nonceD = handshake.nonce();
  const nonceB = handshake.nonce();
  const common = { nonceD, nonceB, roomId: 'room' };
  const device = await handshake.derive({
    ...common,
    role: 'device',
    staticPrivate: devStatic.privateKey,
    staticPeerPublic: boxStatic.publicKey,
    ephemeralPrivate: devEph.privateKey,
    ephemeralPeerPublic: boxEph.publicKey,
  });
  const box = await handshake.derive({
    ...common,
    role: 'box',
    staticPrivate: boxStatic.privateKey,
    staticPeerPublic: devStatic.publicKey,
    ephemeralPrivate: boxEph.privateKey,
    ephemeralPeerPublic: devEph.publicKey,
  });
  return { device, box, boxStatic, devStatic, boxEph, devEph, common };
};

test('generateKeyPair yields a 32-byte public key', async () => {
  const pair = await handshake.generateKeyPair();
  expect(pair.publicKey).toHaveLength(32);
  expect(pair.privateKey.extractable).toBe(false);
});

test('static private keys survive export and import', async () => {
  const pair = await handshake.generateKeyPair(true);
  const restored = await handshake.importPrivateKey(
    await handshake.exportPrivateKey(pair.privateKey),
  );
  expect(restored.algorithm.name).toBe('X25519');
  expect(restored.extractable).toBe(true);
});

test('both roles derive matching directional keys', async () => {
  const { device, box } = await session();
  expect(await sameKey(device.send, box.recv)).toBe(true);
  expect(await sameKey(box.send, device.recv)).toBe(true);
});

test('the two directions use different keys', async () => {
  const { device, box } = await session();
  expect(await sameKey(device.send, device.recv)).toBe(false);
  expect(await sameKey(box.send, box.recv)).toBe(false);
});

test('a different room, nonce or static key yields different keys', async () => {
  const s = await session();
  const other = await handshake.generateKeyPair(true);
  const base = {
    role: 'box' as const,
    staticPrivate: s.boxStatic.privateKey,
    staticPeerPublic: s.devStatic.publicKey,
    ephemeralPrivate: s.boxEph.privateKey,
    ephemeralPeerPublic: s.devEph.publicKey,
    ...s.common,
  };
  const variants = [
    { ...base, roomId: 'other' },
    { ...base, nonceB: handshake.nonce() },
    { ...base, staticPeerPublic: other.publicKey },
  ];
  const results = await Promise.all(
    variants.map(async (v) => sameKey(s.device.send, (await handshake.derive(v)).recv)),
  );
  expect(results).toEqual([false, false, false]);
});

test('derive rejects a peer public key of the wrong length', async () => {
  const s = await session();
  await expect(
    handshake.derive({
      role: 'box',
      staticPrivate: s.boxStatic.privateKey,
      staticPeerPublic: s.devStatic.publicKey.slice(1),
      ephemeralPrivate: s.boxEph.privateKey,
      ephemeralPeerPublic: s.devEph.publicKey,
      ...s.common,
    }),
  ).rejects.toThrow(ProtocolError);
});

const key = base64url.encode(new Uint8Array(32));
const nonce16 = base64url.encode(new Uint8Array(16));

test.each([
  [{ v: 1, devPub: key, devEph: key, nonceD: nonce16 }, true],
  [{ v: 2, devPub: key, devEph: key, nonceD: nonce16 }, false],
  [{ v: 1, devPub: key, devEph: key }, false],
  [{ v: 1, devPub: key, devEph: key, nonceD: key }, false],
  [{ v: 1, devPub: 'not base64!', devEph: key, nonceD: nonce16 }, false],
  [{ v: 1, devPub: 7, devEph: key, nonceD: nonce16 }, false],
  ['string', false],
])('isDeviceHello(%j) is %s', (value, expected) => {
  expect(handshake.isDeviceHello(value)).toBe(expected);
});

test.each([
  [{ v: 1, boxEph: key, nonceB: nonce16 }, true],
  [{ v: 1, boxEph: key, nonceB: key }, false],
  [{ v: 1, boxEph: base64url.encode(new Uint8Array(31)), nonceB: nonce16 }, false],
  [null, false],
])('isBoxHello(%j) is %s', (value, expected) => {
  expect(handshake.isBoxHello(value)).toBe(expected);
});

test('nonce is 16 fresh random bytes', () => {
  const a = handshake.nonce();
  expect(a).toHaveLength(16);
  expect(bytes.equals(a, handshake.nonce())).toBe(false);
});
