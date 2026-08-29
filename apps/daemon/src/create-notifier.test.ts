import type { FluxEvent } from '@flux/protocol';
import { expect, test } from 'vitest';

import { createDeviceStore } from './create-device-store.ts';
import { createNotifier } from './create-notifier.ts';
import { createPushStore } from './create-push-store.ts';
import { openDatabase } from './open-database.ts';

const receiver = async (): Promise<{ p256dh: string; auth: string }> => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    p256dh: Buffer.from(raw).toString('base64url'),
    auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url'),
  };
};

const urlOf = (input: string | URL | Request): string => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
};

const goneOnTwo = (url: string): number => (url.endsWith('/2') ? 410 : 500);

const event = (type: FluxEvent['type'], payload: unknown, session = 's1'): FluxEvent =>
  // The notifier only reads type, session and payload; the envelope is otherwise irrelevant here.
  ({ seq: 1, ts: '2026-01-01T00:00:00Z', session, type, payload });

const setup = async (statusFor: (url: string) => number) => {
  const db = openDatabase(':memory:');
  await createDeviceStore({ db }).identity();
  const push = createPushStore(db);
  push.put('d1', { endpoint: 'https://push.example/1', keys: await receiver() });
  push.put('d2', { endpoint: 'https://push.example/2', keys: await receiver() });
  const posted: string[] = [];
  const notifier = await createNotifier({
    push,
    subject: 'mailto:ops@example.com',
    fetch: (input) => {
      posted.push(urlOf(input));
      return Promise.resolve(new Response(null, { status: statusFor(urlOf(input)) }));
    },
  });
  return { push, posted, notifier };
};

test('pushes asks, done/blocked notifies and running→idle to every subscription', async () => {
  const { posted, notifier } = await setup(() => 201);
  expect(notifier.vapidPublicKey).toMatch(/^B[\w-]{86}$/u);
  await notifier.notify(event('ask', { askId: 'a', question: 'ship?', timeoutAt: 'x' }));
  await notifier.notify(event('notify', { level: 'info', summary: 'progress' }));
  await notifier.notify(event('notify', { level: 'done', summary: 'finished' }));
  await notifier.notify(event('session.state', { state: 'idle' }));
  await notifier.notify(event('session.state', { state: 'running' }));
  await notifier.notify(event('session.state', { state: 'idle' }));
  await notifier.notify(event('msg.user', { text: 'hi' }));
  expect(posted).toHaveLength(6);
});

test('forgets subscriptions the push service reports gone', async () => {
  const { push, posted, notifier } = await setup(goneOnTwo);
  await notifier.notify(event('notify', { level: 'blocked', summary: 'stuck' }));
  expect(posted).toHaveLength(2);
  expect(push.all().map((s) => s.endpoint)).toEqual(['https://push.example/1']);
});
