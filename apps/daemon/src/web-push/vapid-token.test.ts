import { base64url } from '@flux/protocol';
import { expect, test } from 'vitest';

import type { VapidKeys } from './vapid-token.ts';
import { vapidToken } from './vapid-token.ts';

const text = new TextDecoder();

const generate = async (): Promise<VapidKeys> => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  return {
    publicKey: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
    privateKey: pair.privateKey,
  };
};

const parseHeader = (header: string): { jwt: string; key: string } => {
  const match = /^vapid t=(?<jwt>[^,]+), k=(?<key>.+)$/u.exec(header);
  return { jwt: match?.groups?.['jwt'] ?? '', key: match?.groups?.['key'] ?? '' };
};

const json = (segment: string): unknown => JSON.parse(text.decode(base64url.decode(segment)));

test('produces an ES256 JWT for the endpoint origin that verifies with the public key', async () => {
  const keys = await generate();
  const now = 1_700_000_000_000;
  const header = await vapidToken({
    keys,
    endpoint: 'https://push.example.net/send/abc',
    subject: 'mailto:ops@example.com',
    now,
  });
  const { jwt, key } = parseHeader(header);
  expect(key).toBe(base64url.encode(keys.publicKey));
  const [h = '', c = '', s = ''] = jwt.split('.');
  expect(json(h)).toEqual({ typ: 'JWT', alg: 'ES256' });
  expect(json(c)).toEqual({
    aud: 'https://push.example.net',
    exp: 1_700_000_000 + 12 * 3600,
    sub: 'mailto:ops@example.com',
  });
  const publicKey = await crypto.subtle.importKey(
    'raw',
    keys.publicKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const verified = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    base64url.decode(s),
    new TextEncoder().encode(`${h}.${c}`),
  );
  expect(verified).toBe(true);
  expect(base64url.decode(s)).toHaveLength(64);
});
