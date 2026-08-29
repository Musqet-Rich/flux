import { expect, test } from 'vitest';

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
