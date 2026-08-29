import { expect, test } from 'vitest';

import { sendPush } from './send-push.ts';
import type { VapidKeys } from './vapid-token.ts';

const generate = async (): Promise<VapidKeys> => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ]);
  return {
    publicKey: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
    privateKey: pair.privateKey,
  };
};

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

interface Seen {
  url: string;
  init: RequestInit;
}

const fakeFetch = (status: number, seen: Seen[]): typeof fetch => {
  const impl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    seen.push({ url: urlOf(input), init: init ?? {} });
    return Promise.resolve(new Response(null, { status }));
  };
  return impl;
};

const send = async (status: number, seen: Seen[]) =>
  sendPush({
    target: { endpoint: 'https://push.example.net/send/1', keys: await receiver() },
    payload: new TextEncoder().encode('{"session":"s"}'),
    vapid: await generate(),
    subject: 'mailto:ops@example.com',
    fetch: fakeFetch(status, seen),
  });

test('posts an aes128gcm body with VAPID authorization', async () => {
  const seen: Seen[] = [];
  expect(await send(201, seen)).toBe('sent');
  const [request] = seen;
  expect(request?.url).toBe('https://push.example.net/send/1');
  expect(request?.init.method).toBe('POST');
  const headers = new Headers(request?.init.headers);
  expect(headers.get('content-encoding')).toBe('aes128gcm');
  expect(headers.get('ttl')).toBe('60');
  expect(headers.get('authorization')).toMatch(/^vapid t=.+, k=.+$/u);
  expect(request?.init.body).toBeInstanceOf(Uint8Array);
});

test('reports dead subscriptions as gone and other errors as failed', async () => {
  expect(await send(410, [])).toBe('gone');
  expect(await send(404, [])).toBe('gone');
  expect(await send(500, [])).toBe('failed');
});

test('a network error is failed, not thrown', async () => {
  const outcome = await sendPush({
    target: { endpoint: 'https://push.example.net/send/1', keys: await receiver() },
    payload: new Uint8Array(1),
    vapid: await generate(),
    subject: 'mailto:ops@example.com',
    fetch: () => Promise.reject(new Error('offline')),
  });
  expect(outcome).toBe('failed');
});
