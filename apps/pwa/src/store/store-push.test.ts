import { pairing } from '@flux/protocol';
import { expect, test } from 'vitest';

import type { Handlers } from '../../test/fake-relay.ts';
import { createFakeRelay } from '../../test/fake-relay.ts';
import { ClientError } from '../client/client-error.ts';
import { createMemoryStorage } from '../client/create-memory-storage.ts';
import { createStore } from './create-store.ts';

// The push subscription's side of the store: when "Enable notifications" is on offer, and what
// a tap on it does when the browser refuses.

interface Options {
  // A browser that has not granted notification permission: only a prompted subscribe works.
  silentPush?: boolean;
  // A page that can never subscribe (the dev server, a browser without push): no subscribePush.
  pushable?: boolean;
  // The ClientError code a prompted subscribe rejects with.
  pushRefusal?: string;
}

const setup = async ({ silentPush = false, pushable = true, pushRefusal }: Options = {}) => {
  const handlers: Handlers = {
    hello: () => ({ protocol: 1, daemon: 'box', sessions: [], vapidPublicKey: 'a2V5' }),
    'pair.request': () => ({ deviceId: 'dev-1' }),
    'push.subscribe': () => ({}),
  };
  const relay = await createFakeRelay(handlers);
  const pushes: string[] = [];
  const subscribePush = (key: string, prompt: boolean): Promise<unknown> => {
    pushes.push(`${key}:${prompt ? 'prompt' : 'silent'}`);
    const granted = prompt || !silentPush;
    return prompt && pushRefusal !== undefined
      ? Promise.reject(new ClientError(pushRefusal, `push ${pushRefusal}`))
      : Promise.resolve(granted ? { endpoint: 'https://push.example/x' } : null);
  };
  const store = createStore({
    storage: createMemoryStorage(),
    socket: relay.socket,
    ...(pushable ? { subscribePush } : {}),
    minBackoffMs: 1,
    maxBackoffMs: 5,
  });
  const secret = new Uint8Array(pairing.secretLength);
  const url = pairing.url('https://relay.example', { boxPub: relay.boxPub, secret });
  await store.pair('https://relay.example', new URL(url).hash);
  return { store, handlers, pushes };
};

test('push stays off until a prompted subscribe reaches the box, and retries after a refusal', async () => {
  const { store, pushes, handlers } = await setup({ silentPush: true });
  delete handlers['push.subscribe'];
  expect(store.state.push).toBe('off');
  expect(pushes).toEqual(['a2V5:silent']);
  expect(await store.enablePush()).toBe(false);
  expect(store.state).toMatchObject({ push: 'off', error: { message: 'no push.subscribe' } });
  handlers['push.subscribe'] = () => ({});
  expect(await store.enablePush()).toBe(true);
  expect(store.state.push).toBe('on');
  expect(pushes).toEqual(['a2V5:silent', 'a2V5:prompt', 'a2V5:prompt']);
  expect(await store.enablePush()).toBe(false);
  store.stop();
});

// Dogfooding 2026-08-29: "Enable notifications" did nothing on the dev server, where no worker
// is registered. A page that cannot subscribe never gets the offer; a refused prompt says why.
test('push stays unavailable without a way to subscribe, and a refused prompt is an error', async () => {
  const silent = await setup({ pushable: false });
  expect(silent.store.state.push).toBe('unavailable');
  expect(await silent.store.enablePush()).toBe(false);
  expect(silent.store.state.error).toBeNull();
  silent.store.stop();
  const denied = await setup({ silentPush: true, pushRefusal: 'push_denied' });
  expect(await denied.store.enablePush()).toBe(false);
  expect(denied.store.state).toMatchObject({
    push: 'off',
    error: { message: 'push push_denied', kind: 'action' },
  });
  denied.store.stop();
  const unsupported = await setup({ silentPush: true, pushRefusal: 'push_unsupported' });
  expect(await unsupported.store.enablePush()).toBe(false);
  expect(unsupported.store.state.push).toBe('unavailable');
  expect(unsupported.store.state.error?.message).toBe('push push_unsupported');
  unsupported.store.stop();
});
