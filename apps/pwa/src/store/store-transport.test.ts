import { pairing } from '@flux/protocol';
import { expect, test } from 'vitest';

import { createFakeRelay } from '../../test/fake-relay.ts';
import { createMemoryStorage } from '../client/create-memory-storage.ts';
import { pairedBox } from '../client/paired-box.ts';
import { createStore } from './create-store.ts';

// The store's side of protocol.md § 2: a plaintext relay is only the developer's own machine.
// A pairing link with any other http:// origin is refused before a socket opens, and a stored
// box with such a relay lands on the pair screen with the reason rather than connecting.

const setup = async () => {
  const relay = await createFakeRelay({
    hello: () => ({ protocol: 2, daemon: 'box', sessions: [] }),
    'pair.request': () => ({ deviceId: 'dev-1' }),
  });
  const storage = createMemoryStorage();
  const store = () =>
    createStore({ storage, socket: relay.socket, minBackoffMs: 1, maxBackoffMs: 5 });
  const link = (): string => {
    const secret = new Uint8Array(pairing.secretLength);
    return new URL(pairing.url('https://relay.example', { boxPub: relay.boxPub, secret })).hash;
  };
  return { relay, storage, store, link };
};

test('refuses a plaintext relay off loopback when pairing', async () => {
  const { relay, store, link } = await setup();
  const first = store();
  await first.pair('http://relay.example', link());
  expect(first.state.phase).toBe('unpaired');
  expect(first.state.error).toMatchObject({ kind: 'connection' });
  expect(first.state.error?.message).toContain('https://');
  expect(relay.guests()).toBe(0);
  await first.pair('http://localhost:5173', link());
  expect(first.state.phase).toBe('paired');
  expect(first.state.error).toBeNull();
  first.stop();
});

test('a stored box behind a plaintext relay lands on the pair screen', async () => {
  const { storage, store, link } = await setup();
  const first = store();
  await first.pair('https://relay.example', link());
  first.stop();
  const stored = await storage.get(pairedBox.storageKey);
  const record = { ...(stored as Record<string, unknown>), relayUrl: 'http://relay.example' };
  await storage.set(pairedBox.storageKey, record);
  const second = store();
  await second.boot();
  expect(second.state.phase).toBe('unpaired');
  expect(second.state.error).toMatchObject({ kind: 'connection' });
  expect(second.state.error?.message).toContain('https://');
  second.stop();
});
