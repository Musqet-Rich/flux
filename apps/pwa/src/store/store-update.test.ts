import { pairing } from '@flux/protocol';
import { expect, test } from 'vitest';

import { createFakeRelay } from '../../test/fake-relay.ts';
import { until } from '../../test/until.ts';
import { createMemoryStorage } from '../client/create-memory-storage.ts';
import { createStore } from './create-store.ts';

// The store's side of the daemon self-update (ADR 0022): the action sends `daemon.update`, the
// `update.progress` / `update.failed` ephemerals drive the visible state, a refusal clears the
// in-progress marker, and a reconnect on the installed version clears the banner.

const setup = async () => {
  let daemonVersion = '1.0.0';
  const relay = await createFakeRelay({
    hello: () => ({ protocol: 2, daemon: 'box', sessions: [], version: daemonVersion }),
    'pair.request': () => ({ deviceId: 'dev-1' }),
    'daemon.update': () => ({}),
  });
  const storage = createMemoryStorage();
  const store = createStore({ storage, socket: relay.socket, minBackoffMs: 1, maxBackoffMs: 5 });
  const link = (): string => {
    const secret = new Uint8Array(pairing.secretLength);
    return new URL(pairing.url('https://relay.example', { boxPub: relay.boxPub, secret })).hash;
  };
  const setVersion = (v: string): void => {
    daemonVersion = v;
  };
  const called = (method: string) => relay.calls.filter((c) => c.method === method);
  return { relay, store, link, setVersion, called };
};

test('starts an update, then tracks progress and a failure from the ephemerals', async () => {
  const { store, relay, link, called } = await setup();
  await store.pair('https://relay.example', link());
  expect(await store.updateDaemon('9.9.9')).toBe(true);
  expect(called('daemon.update')[0]?.params).toEqual({ version: '9.9.9' });
  expect(store.state.update.target).toBe('9.9.9');
  await relay.ephemeral({ type: 'update.progress', phase: 'installing' });
  await until(() => store.state.update.phase === 'installing');
  await relay.ephemeral({ type: 'update.failed', reason: 'bad_signature' });
  await until(() => store.state.update.failed === 'bad_signature');
  store.stop();
});

test('a refused update clears the in-progress marker and reports the error', async () => {
  const { store, relay, link } = await setup();
  await store.pair('https://relay.example', link());
  relay.refuseCall('daemon.update', 'unsupported');
  expect(await store.updateDaemon('9.9.9')).toBe(false);
  expect(store.state.update.target).toBeNull();
  expect(store.state.error).toMatchObject({ kind: 'action' });
  store.stop();
});

test('a reconnect on the installed version clears the update banner', async () => {
  const { store, relay, link, setVersion } = await setup();
  await store.pair('https://relay.example', link());
  expect(await store.updateDaemon('1.2.0')).toBe(true);
  expect(store.state.update.target).toBe('1.2.0');
  setVersion('1.2.0');
  relay.dropGuests();
  await until(() => store.state.update.target === null);
  expect(store.state.daemonVersion).toBe('1.2.0');
  store.stop();
});
