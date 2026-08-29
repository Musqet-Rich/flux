import { bytes, handshake, pairing } from '@flux/protocol';
import { expect, test } from 'vitest';

import { createDeviceStore } from './create-device-store.ts';
import { DaemonError } from './daemon-error.ts';
import { openDatabase } from './open-database.ts';

const setup = (ttl = 60_000) => {
  const clock = { t: Date.UTC(2026, 7, 29, 10) };
  const db = openDatabase(':memory:');
  const store = createDeviceStore({ db, now: () => new Date(clock.t), secretTtlMs: ttl });
  return { store, db, clock };
};

const devKey = async (): Promise<Uint8Array<ArrayBuffer>> =>
  (await handshake.generateKeyPair()).publicKey;

test('identity is generated once and reloaded from the database', async () => {
  const { store, db } = setup();
  const first = await store.identity();
  expect(first.publicKey).toHaveLength(32);
  expect(await store.identity()).toBe(first);
  const reopened = createDeviceStore({ db });
  const again = await reopened.identity();
  expect(again.publicKey).toEqual(first.publicKey);
  expect(again.privateKey.algorithm.name).toBe('X25519');
});

test('a device pairs with a valid proof, and the secret is burned', async () => {
  const { store } = setup();
  const box = await store.identity();
  const secret = store.newSecret();
  const devPub = await devKey();
  const proof = await pairing.proof(secret, devPub, box.publicKey);
  const device = await store.pair(devPub, proof, 'phone');
  expect(device).toMatchObject({ name: 'phone', pairedAt: '2026-08-29T10:00:00.000Z' });
  expect(device?.publicKey).toEqual(devPub);
  expect(store.devices()).toHaveLength(1);
  expect(store.deviceByKey(devPub)?.deviceId).toBe(device?.deviceId);
  expect(await store.pair(devPub, proof, 'phone')).toBeNull();
});

test('pairing the same key again returns the existing device', async () => {
  const { store } = setup();
  const box = await store.identity();
  const devPub = await devKey();
  const first = await store.pair(
    devPub,
    await pairing.proof(store.newSecret(), devPub, box.publicKey),
    'a',
  );
  const second = await store.pair(
    devPub,
    await pairing.proof(store.newSecret(), devPub, box.publicKey),
    'b',
  );
  expect(second?.deviceId).toBe(first?.deviceId);
  expect(store.devices()).toHaveLength(1);
});

test('three bad proofs burn a secret', async () => {
  const { store } = setup();
  const box = await store.identity();
  const secret = store.newSecret();
  const devPub = await devKey();
  const bad = bytes.random(32);
  expect(await store.pair(devPub, bad, 'x')).toBeNull();
  expect(await store.pair(devPub, bad, 'x')).toBeNull();
  expect(await store.pair(devPub, bad, 'x')).toBeNull();
  const good = await pairing.proof(secret, devPub, box.publicKey);
  expect(await store.pair(devPub, good, 'x')).toBeNull();
});

test('secrets expire', async () => {
  const { store, clock } = setup(1000);
  const box = await store.identity();
  const secret = store.newSecret();
  const devPub = await devKey();
  const proof = await pairing.proof(secret, devPub, box.publicKey);
  clock.t += 1000;
  expect(await store.pair(devPub, proof, 'x')).toBeNull();
});

test('devices can be removed, unknown ids are not_found', async () => {
  const { store } = setup();
  const box = await store.identity();
  const devPub = await devKey();
  await store.pair(devPub, await pairing.proof(store.newSecret(), devPub, box.publicKey), 'a');
  store.remove(String(store.devices()[0]?.deviceId));
  expect(store.devices()).toEqual([]);
  expect(store.deviceByKey(devPub)).toBeNull();
  expect(() => {
    store.remove('nope');
  }).toThrow(DaemonError);
});
