import { expect, test } from 'vitest';

import { createDeviceStore } from './create-device-store.ts';
import { createPushStore } from './create-push-store.ts';
import { openDatabase } from './open-database.ts';

const sub = { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } };

test('stores, replaces by endpoint, lists and removes subscriptions', () => {
  const store = createPushStore(openDatabase(':memory:'));
  expect(store.put('d1', { ...sub, expirationTime: null })).toEqual(sub);
  store.put('d1', { ...sub, keys: { p256dh: 'p2', auth: 'a2' } });
  store.put('d2', { ...sub, endpoint: 'https://push.example/2' });
  expect(store.all()).toEqual([
    { ...sub, keys: { p256dh: 'p2', auth: 'a2' } },
    { ...sub, endpoint: 'https://push.example/2' },
  ]);
  store.remove(sub.endpoint);
  expect(store.all()).toHaveLength(1);
});

test('rejects anything that is not a subscription', () => {
  const store = createPushStore(openDatabase(':memory:'));
  expect(() => store.put('d', { endpoint: 'x' })).toThrow(TypeError);
  expect(() => store.put('d', 'nope')).toThrow(TypeError);
});

test('the VAPID key is generated once beside the identity and reloaded afterwards', async () => {
  const db = openDatabase(':memory:');
  const store = createPushStore(db);
  await expect(store.vapid()).rejects.toThrow('box identity missing');
  await createDeviceStore({ db }).identity();
  const first = await store.vapid();
  expect(first.publicKey).toHaveLength(65);
  expect(first.publicKey[0]).toBe(4);
  const again = await createPushStore(db).vapid();
  expect(again.publicKey).toEqual(first.publicKey);
  const data = new Uint8Array([1, 2, 3]);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    again.privateKey,
    data,
  );
  const publicKey = await crypto.subtle.importKey(
    'raw',
    first.publicKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  expect(
    await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, data),
  ).toBe(true);
});
