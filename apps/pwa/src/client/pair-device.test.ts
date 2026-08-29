import { base64url, pairing } from '@flux/protocol';
import { expect, test } from 'vitest';

import { createFakeRelay } from '../../test/fake-relay.ts';
import { pairDevice } from './pair-device.ts';
import { pairedBox } from './paired-box.ts';
import { createMemoryStorage } from './create-memory-storage.ts';

const secret = crypto.getRandomValues(new Uint8Array(pairing.secretLength));

test('pairs from a link, then the record round-trips through storage', async () => {
  const relay = await createFakeRelay({ 'pair.request': () => ({ deviceId: 'dev-1' }) });
  const url = pairing.url('https://relay.example', { boxPub: relay.boxPub, secret });
  const fragment = new URL(url).hash;
  const { box, connection } = await pairDevice({
    relayUrl: 'https://relay.example',
    fragment,
    socket: relay.socket,
    onEvent: () => {},
    onEphemeral: () => {},
  });
  expect(box.record.deviceId).toBe('dev-1');
  expect(box.record.boxPub).toBe(base64url.encode(relay.boxPub));
  const [call] = relay.calls;
  expect(call?.method).toBe('pair.request');
  const storage = createMemoryStorage();
  await storage.set(pairedBox.storageKey, box.record);
  const loaded = await pairedBox.load(await storage.get(pairedBox.storageKey));
  expect(loaded?.record).toEqual(box.record);
  expect(loaded?.keys.publicKey).toEqual(box.keys.publicKey);
  expect(await pairedBox.load({ relayUrl: 'x' })).toBeNull();
  connection.stop();
});

test('rejects a link that is not a pairing link', async () => {
  const relay = await createFakeRelay({});
  await expect(
    pairDevice({
      relayUrl: 'https://relay.example',
      fragment: '#nope',
      socket: relay.socket,
      onEvent: () => {},
      onEphemeral: () => {},
    }),
  ).rejects.toMatchObject({ code: 'bad_pairing' });
});
