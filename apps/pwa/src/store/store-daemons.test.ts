import { handshake } from '@flux/protocol';
import { expect, test } from 'vitest';

import { twoDaemons } from '../../test/two-daemons.ts';
import { until } from '../../test/until.ts';
import { pairedBox } from '../client/paired-box.ts';
import type { Store } from './create-store.ts';
import { pairings } from './pairings.ts';

// Several daemons through one store (ADR 0037): pairing a second beside the first, one
// connection open at a time, switching with each daemon's drafts and cache kept apart, boot
// opening the daemon used last or the one a notification named, and the operator's Unpair.

const { setup, event } = twoDaemons;

const names = (store: Store) => store.state.daemons.map((d) => d.name);

test('pairs a second daemon beside the first; one connection, drafts kept per daemon', async () => {
  const { work, hobby, pushes, make } = await setup();
  const store = make();
  expect(await store.pair('https://relay.example', work.link)).toBe(true);
  expect(store.state).toMatchObject({ phase: 'paired', activeDaemon: work.id, daemon: 'work' });
  store.state.drafts['s1\u0000a.txt'] = { hash: 'h', text: 'unsent on work' };
  expect(await store.pair('https://relay.example', hobby.link)).toBe(true);
  await until(() => store.state.daemon === 'hobby');
  expect(store.state.activeDaemon).toBe(hobby.id);
  expect(names(store)).toEqual(['work', 'hobby']);
  expect(store.state.drafts).toEqual({});
  await until(() => work.relay.guests() === 0);
  expect(hobby.relay.guests()).toBe(1);
  expect(pushes).toEqual([work.id, hobby.id]);
  expect(await store.switchDaemon(work.id)).toBe(true);
  await until(() => store.state.daemon === 'work');
  expect(store.state.drafts['s1\u0000a.txt']?.text).toBe('unsent on work');
  expect(store.state.sessions.map((x) => x.session)).toEqual(['s1']);
  await until(() => hobby.relay.guests() === 0);
  store.stop();
});

test('boot opens the daemon used last, or the one a notification named', async () => {
  const { work, hobby, make } = await setup();
  const first = make();
  await first.pair('https://relay.example', work.link);
  await first.pair('https://relay.example', hobby.link);
  await first.switchDaemon(work.id);
  first.stop();
  const again = make();
  await again.boot();
  expect(again.state.activeDaemon).toBe(work.id);
  again.stop();
  const tapped = make();
  await tapped.boot(hobby.id);
  expect(tapped.state.activeDaemon).toBe(hobby.id);
  tapped.stop();
  const unknown = make();
  await unknown.boot('not-paired');
  expect(unknown.state.activeDaemon).toBe(hobby.id);
  unknown.stop();
});

test("each daemon's log is cached under its own prefix and shown only on it", async () => {
  const { work, hobby, storage, make, fire } = await setup();
  const store = make();
  await store.pair('https://relay.example', work.link);
  await store.open('s1');
  expect(store.state.logs['s1']?.events).toEqual([event('from work')]);
  await store.pair('https://relay.example', hobby.link);
  expect(store.state.logs).toEqual({});
  await store.open('s1');
  expect(store.state.logs['s1']?.events).toEqual([event('from hobby')]);
  fire();
  expect(await storage.get('log:s1:0')).toEqual([event('from work')]);
  expect(await storage.get(`daemon:${hobby.id}:log:s1:0`)).toEqual([event('from hobby')]);
  store.stop();
});

test('Unpair revokes this device on the daemon, forgets it here and opens the other', async () => {
  const { work, hobby, storage, forgotten, make, fire } = await setup();
  const store = make();
  await store.pair('https://relay.example', work.link);
  await store.setSendKey('shift');
  await store.pair('https://relay.example', hobby.link);
  await store.open('s1');
  fire();
  expect(await store.unpairDevice()).toBe(true);
  expect(hobby.called('devices.remove').map((c) => c.params)).toEqual([{ deviceId: 'dev-hobby' }]);
  expect(store.state).toMatchObject({ phase: 'paired', activeDaemon: work.id, error: null });
  expect(names(store)).toEqual(['work']);
  expect((await pairings.load(storage)).entries.map((e) => e.id)).toEqual([work.id]);
  expect(await storage.get(`daemon:${hobby.id}:log:s1:0`)).toBeUndefined();
  expect(forgotten).toEqual([hobby.id]);
  // The device's own preferences are not the daemon's.
  expect(store.state.sendKey).toBe('shift');
  store.stop();
});

test('Unpair with the daemon out of reach forgets it here and says it will still be listed', async () => {
  const { work, storage, make } = await setup();
  const store = make();
  await store.pair('https://relay.example', work.link);
  work.relay.hostLeave();
  await until(() => store.state.status === 'no_host');
  expect(await store.unpairDevice()).toBe(false);
  expect(work.called('devices.remove')).toEqual([]);
  expect(store.state.phase).toBe('unpaired');
  expect(store.state.error?.message).toContain('will keep listing it');
  expect(await pairings.load(storage)).toEqual({ active: null, entries: [] });
  store.stop();
});

test('the open daemon revoking this device opens the other, saying which let go', async () => {
  const { work, hobby, make } = await setup();
  const store = make();
  await store.pair('https://relay.example', work.link);
  await store.pair('https://relay.example', hobby.link);
  await until(() => store.state.daemon === 'hobby');
  await hobby.relay.ephemeral({ type: 'device.revoked', deviceId: 'dev-hobby' });
  await until(() => store.state.daemon === 'work');
  expect(store.state.error).toMatchObject({ kind: 'action' });
  expect(store.state.error?.message).toContain('no longer paired with hobby');
  store.stop();
});

test('a pairing beside an open daemon that fails leaves it open; a cancelled one says nothing', async () => {
  const { work, hobby, make } = await setup();
  const store = make();
  await store.pair('https://relay.example', work.link);
  expect(await store.pair('https://relay.example', '#not-a-link')).toBe(false);
  expect(store.state).toMatchObject({ phase: 'paired', activeDaemon: work.id });
  expect(store.state.error?.kind).toBe('action');
  store.dismissError();
  const abort = new AbortController();
  abort.abort();
  expect(await store.pair('https://relay.example', hobby.link, abort.signal)).toBe(false);
  expect(store.state).toMatchObject({ activeDaemon: work.id, error: null });
  expect(names(store)).toEqual(['work']);
  store.stop();
});

// Updating the app must not cost a pairing: the one an app from before kept, and its cached logs,
// open as they were, and its push subscription moves off the root worker once it has one of its
// own on the box.
test('the single pairing from before opens on upgrade with its cache, and its push moves', async () => {
  const { work, storage, written, pushes, forgotten, make } = await setup();
  const device = await handshake.generateKeyPair(true);
  const box = await pairedBox.create('https://relay.example', work.relay.boxPub, device, 'dev-1');
  await storage.set(pairedBox.storageKey, box.record);
  await storage.set('log:s1:0', [event('cached before the update')]);
  const store = make();
  await store.boot();
  expect(store.state).toMatchObject({ phase: 'paired', activeDaemon: work.id });
  await store.open('s1');
  expect(store.state.logs['s1']?.events[0]).toEqual(event('cached before the update'));
  await until(() => store.state.push === 'on');
  expect(pushes).toEqual([work.id]);
  await until(() => forgotten.length === 1);
  expect(forgotten).toEqual([null]);
  const moved = { id: work.id, name: 'work', cache: 'log:', rootPush: false };
  await until(() => {
    const record = written.get(pairings.storageKey);
    return JSON.stringify(record).includes('"rootPush":false');
  });
  expect((await pairings.load(storage)).entries).toMatchObject([moved]);
  expect(await storage.get(pairedBox.storageKey)).toBeUndefined();
  store.stop();
});
