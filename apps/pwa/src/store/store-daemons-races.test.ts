import { expect, test } from 'vitest';
import { shallowReactive } from 'vue';

import { twoDaemons } from '../../test/two-daemons.ts';
import { until } from '../../test/until.ts';
import type { Storage } from '../client/create-memory-storage.ts';
import { pairings } from './pairings.ts';

// The multi-daemon store where things overlap (ADR 0037): a push subscription that resolves
// after another daemon opened, an Unpair tapped while a switch is connecting, a forget whose
// write fails, and a storage that cannot be read at boot. None may leave a second connection
// open, store a subscription on the wrong daemon, or lose a pairing it was not asked to.

test('a push subscription that resolves after a switch is not stored on the new daemon', async () => {
  const { work, hobby, make } = await twoDaemons.setup();
  // Each subscribe waits for the test to let it go, as a worker registering or a prompt would.
  const waiting = shallowReactive<(() => void)[]>([]);
  const store = make({
    subscribePush: (_key, _prompt, id) =>
      new Promise((resolve) => {
        waiting.push(() => {
          resolve({ endpoint: `https://push.example/${id}` });
        });
      }),
  });
  // Each pairing's hello waits on its subscribe, so neither is awaited until both are let go.
  const first = store.pair('https://relay.example', work.link);
  await until(() => waiting.length === 1);
  const second = store.pair('https://relay.example', hobby.link);
  await until(() => waiting.length === 2);
  waiting[0]?.();
  waiting[1]?.();
  expect(await Promise.all([first, second])).toEqual([true, true]);
  expect(store.state.push).toBe('on');
  expect(hobby.called('push.subscribe').map((c) => c.params)).toEqual([
    { subscription: { endpoint: `https://push.example/${hobby.id}` } },
  ]);
  expect(work.called('push.subscribe')).toEqual([]);
  store.stop();
});

// The Unpair lands on the daemon still open when it is tapped (hobby), the switch then opens
// work, and the forget that follows leaves work open rather than opening another. Whether hobby
// heard the revoke depends on which stopped first, so only what must hold is checked.
test('Unpair tapped as a switch starts forgets the open daemon and leaves one connection', async () => {
  const { work, hobby, storage, make } = await twoDaemons.setup();
  const store = make();
  await store.pair('https://relay.example', work.link);
  await store.pair('https://relay.example', hobby.link);
  const switching = store.switchDaemon(work.id);
  const unpairing = store.unpairDevice();
  await Promise.all([switching, unpairing]);
  await until(() => store.state.status === 'connected');
  expect(store.state.activeDaemon).toBe(work.id);
  await until(() => hobby.relay.guests() === 0);
  expect(work.relay.guests()).toBe(1);
  expect((await pairings.load(storage)).entries.map((e) => e.id)).toEqual([work.id]);
  store.stop();
});

// Storage that refuses every write of the pairings record, as a full disk would.
const refusingPairings = (storage: Storage): Storage => ({
  ...storage,
  set: (key, value) =>
    key === pairings.storageKey ? Promise.reject(new TypeError('quota')) : storage.set(key, value),
});

test('a forget whose write fails still opens the other daemon and says it may come back', async () => {
  const { work, hobby, storage, make } = await twoDaemons.setup();
  const store = make();
  await store.pair('https://relay.example', work.link);
  await store.pair('https://relay.example', hobby.link);
  store.stop();
  const failing = refusingPairings(storage);
  const again = make({ storage: failing });
  await again.boot();
  await until(() => again.state.daemon === 'hobby');
  expect(await again.unpairDevice()).toBe(true);
  expect(again.state.activeDaemon).toBe(work.id);
  expect(again.state.error?.message).toContain('may be back after a reload');
  again.stop();
});

test('a storage that cannot be read at boot lands on the pair screen and writes nothing', async () => {
  const { storage, make } = await twoDaemons.setup();
  const writes: string[] = [];
  const broken: Storage = {
    ...storage,
    get: () => Promise.reject(new TypeError('indexeddb')),
    set: (key) => {
      writes.push(key);
      return Promise.resolve();
    },
  };
  const store = make({ storage: broken });
  await store.boot();
  expect(store.state.phase).toBe('unpaired');
  expect(store.state.error).toMatchObject({ kind: 'connection', message: 'indexeddb' });
  expect(writes).toEqual([]);
  store.stop();
});

test('the carried-over pairing keeps its root subscription while its own cannot be made', async () => {
  const { work, storage, forgotten, make } = await twoDaemons.setup();
  const store = make({ subscribePush: () => Promise.resolve(null) });
  await store.pair('https://relay.example', work.link);
  await pairings.update(storage, (current) => ({
    ...current,
    entries: current.entries.map((e) => ({ ...e, rootPush: true })),
  }));
  store.stop();
  const again = make({ subscribePush: () => Promise.resolve(null) });
  await again.boot();
  await until(() => again.state.push === 'off');
  expect(forgotten).toEqual([]);
  expect((await pairings.load(storage)).entries[0]?.rootPush).toBe(true);
  again.stop();
});

test('Unpair stops waiting for a daemon that does not answer and forgets it here', async () => {
  const { work, timers, make, fire } = await twoDaemons.setup();
  const store = make();
  await store.pair('https://relay.example', work.link);
  work.relay.mute(true);
  const unpairing = store.unpairDevice();
  await until(() => timers.length === 1);
  fire();
  expect(await unpairing).toBe(false);
  expect(store.state.phase).toBe('unpaired');
  expect(store.state.error?.message).toContain('could not be reached');
  store.stop();
});

test('a tap on a root-worker notification opens the carried-over daemon', async () => {
  const { work, hobby, storage, make } = await twoDaemons.setup();
  const first = make();
  await first.pair('https://relay.example', work.link);
  await first.pair('https://relay.example', hobby.link);
  first.stop();
  await pairings.update(storage, (current) => ({
    ...current,
    entries: current.entries.map((e) => ({ ...e, rootPush: e.id === work.id })),
  }));
  const again = make({ subscribePush: () => Promise.resolve(null) });
  await again.boot('root');
  expect(again.state.activeDaemon).toBe(work.id);
  again.stop();
});

test('a git push in flight when another daemon opens says nothing on the new one', async () => {
  const { work, hobby, make } = await twoDaemons.setup();
  const store = make();
  await store.pair('https://relay.example', work.link);
  await store.pair('https://relay.example', hobby.link);
  await store.switchDaemon(work.id);
  await until(() => store.state.daemon === 'work');
  work.relay.mute(true);
  const pushing = store.push('s1');
  await store.switchDaemon(hobby.id);
  expect(await pushing).toBeNull();
  await until(() => store.state.daemon === 'hobby');
  expect(store.state.error).toBeNull();
  store.stop();
});

test('a daemon reopened by a queued switch is let go before its push is forgotten', async () => {
  const { work, hobby, make } = await twoDaemons.setup();
  const order: string[] = [];
  const store = make({
    subscribePush: (_key, _prompt, id) => {
      order.push(`subscribe:${id}`);
      return Promise.resolve({ endpoint: `https://push.example/${id}` });
    },
    forgetPush: (id) => {
      order.push(`forget:${String(id)}`);
      return Promise.resolve();
    },
  });
  await store.pair('https://relay.example', work.link);
  await store.pair('https://relay.example', hobby.link);
  order.splice(0);
  const toWork = store.switchDaemon(work.id);
  const backToHobby = store.switchDaemon(hobby.id);
  const unpairing = store.unpairDevice();
  await Promise.all([toWork, backToHobby, unpairing]);
  await until(() => store.state.status === 'connected');
  expect(store.state.activeDaemon).toBe(work.id);
  expect(order).toContain(`forget:${hobby.id}`);
  expect(order.slice(order.indexOf(`forget:${hobby.id}`))).not.toContain(`subscribe:${hobby.id}`);
  await until(() => hobby.relay.guests() === 0);
  store.stop();
});

test('a daemon paired beside another reports its connection failures once it is open', async () => {
  const { work, hobby, make } = await twoDaemons.setup();
  const store = make();
  await store.pair('https://relay.example', work.link);
  await store.pair('https://relay.example', hobby.link);
  hobby.relay.boxVersion(99);
  hobby.relay.dropGuests();
  await until(() => store.state.error !== null);
  expect(store.state.error?.kind).toBe('connection');
  store.stop();
});
