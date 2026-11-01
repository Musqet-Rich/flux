import { expect, test } from 'vitest';

import { twoDaemons } from '../../test/two-daemons.ts';
import { until } from '../../test/until.ts';
import { pairings } from './pairings.ts';

// A paired daemon that no longer knows this device (ADR 0037): one revoked it from another
// device while it was not the open one, so it never answers this device's handshake, or it
// answers `not_paired`. The open daemon is marked rather than left on "connecting"; Forget
// removes the pairing here without asking the daemon anything; Unpair does not claim the daemon
// will keep listing the device; and a daemon that answers after all is unmarked.

// Long enough for a handshake the box does answer on a loaded machine, short enough for a test.
const handshakeTimeoutMs = 400;

test('switching to a daemon that ignores this device marks it, and Forget opens the other', async () => {
  const { work, hobby, storage, make } = await twoDaemons.setup();
  const store = make({ handshakeTimeoutMs });
  await store.pair('https://relay.example', work.link);
  await store.pair('https://relay.example', hobby.link);
  await store.switchDaemon(work.id);
  hobby.relay.ignoreHandshakes(true);
  await store.switchDaemon(hobby.id);
  await until(() => store.state.unknownDevice === 'unanswered');
  expect(store.state).toMatchObject({ activeDaemon: hobby.id, status: 'connecting', error: null });
  await store.forgetDaemon();
  expect(store.state).toMatchObject({ activeDaemon: work.id, unknownDevice: null, error: null });
  expect(hobby.called('devices.remove')).toEqual([]);
  expect((await pairings.load(storage)).entries.map((e) => e.id)).toEqual([work.id]);
  store.stop();
});

test('Unpair from an unanswering daemon asks nothing and does not say it keeps the device', async () => {
  const { work, hobby, make } = await twoDaemons.setup();
  const store = make({ handshakeTimeoutMs });
  await store.pair('https://relay.example', work.link);
  await store.pair('https://relay.example', hobby.link);
  await store.switchDaemon(work.id);
  hobby.relay.ignoreHandshakes(true);
  await store.switchDaemon(hobby.id);
  await until(() => store.state.unknownDevice === 'unanswered');
  expect(await store.unpairDevice()).toBe(false);
  expect(store.state.activeDaemon).toBe(work.id);
  expect(store.state.error?.message).toContain('did not answer this device');
  expect(store.state.error?.message).not.toContain('will keep listing');
  store.stop();
});

test('booting into a daemon that answers not_paired marks it quietly; Unpair says nothing', async () => {
  const { work, make } = await twoDaemons.setup();
  const first = make();
  await first.pair('https://relay.example', work.link);
  first.stop();
  work.relay.refuseCall('hello', 'not_paired');
  const store = make();
  await store.boot();
  await until(() => store.state.unknownDevice === 'not_paired');
  expect(store.state).toMatchObject({ phase: 'paired', error: null });
  expect(await store.unpairDevice()).toBe(true);
  expect(work.called('devices.remove')).toEqual([]);
  expect(store.state).toMatchObject({ phase: 'unpaired', error: null });
  store.stop();
});

test('a daemon that answers after all is no longer marked', async () => {
  const { work, make } = await twoDaemons.setup();
  const store = make({ handshakeTimeoutMs });
  await store.pair('https://relay.example', work.link);
  work.relay.ignoreHandshakes(true);
  work.relay.dropGuests();
  await until(() => store.state.unknownDevice === 'unanswered');
  work.relay.ignoreHandshakes(false);
  await until(() => store.state.unknownDevice === null);
  expect(store.state.status).toBe('connected');
  store.stop();
});

test('a daemon the relay then says is away is no longer marked as forgetting this device', async () => {
  const { work, make } = await twoDaemons.setup();
  const store = make({ handshakeTimeoutMs });
  await store.pair('https://relay.example', work.link);
  work.relay.ignoreHandshakes(true);
  work.relay.dropGuests();
  await until(() => store.state.unknownDevice === 'unanswered');
  work.relay.hostLeave();
  await until(() => store.state.status === 'no_host');
  expect(store.state.unknownDevice).toBeNull();
  store.stop();
});

test('a first pairing the daemon ignores says the pairing code may have expired', async () => {
  const { work, make } = await twoDaemons.setup();
  const store = make({ handshakeTimeoutMs });
  work.relay.ignoreHandshakes(true);
  const abort = new AbortController();
  const pairing = store.pair('https://relay.example', work.link, abort.signal);
  await until(() => store.state.error !== null);
  expect(store.state.error?.message).toContain('may have expired');
  expect(store.state.phase).toBe('pairing');
  abort.abort();
  expect(await pairing).toBe(false);
  store.stop();
});
