import { base64url } from '@flux/protocol';
import { expect, test } from 'vitest';

import type { SenderKeys } from './encrypt-push.ts';
import { encryptPush } from './encrypt-push.ts';

// RFC 8291 Appendix A, verbatim. Test keys from a published standard, not secrets.
const vector = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24', // secrets-allow
  senderPublic:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8', // secrets-allow
  senderPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', // secrets-allow
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', // secrets-allow
  auth: 'BTBZMqHH6r4Tts7J_aSIgg', // secrets-allow
  salt: 'DGv6ra1nlYgDCS1FRnbzlw', // secrets-allow
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN', // secrets-allow
};

interface Jwk {
  kty: string;
  crv: string;
  x: string;
  y: string;
  d?: string;
}

const jwkFromRaw = (publicRaw: string, privateScalar: string): Jwk => {
  const raw = base64url.decode(publicRaw);
  return {
    kty: 'EC',
    crv: 'P-256',
    x: base64url.encode(raw.subarray(1, 33)),
    y: base64url.encode(raw.subarray(33, 65)),
    d: privateScalar,
  };
};

const importSender = async (): Promise<SenderKeys> => {
  const jwk = jwkFromRaw(vector.senderPublic, vector.senderPrivate);
  const { d: _d, ...publicJwk } = jwk;
  const algorithm = { name: 'ECDH', namedCurve: 'P-256' };
  return {
    privateKey: await crypto.subtle.importKey('jwk', jwk, algorithm, true, ['deriveBits']),
    publicKey: await crypto.subtle.importKey('jwk', publicJwk, algorithm, true, []),
  };
};

test('reproduces the RFC 8291 example byte for byte', async () => {
  const body = await encryptPush({
    keys: { p256dh: vector.p256dh, auth: vector.auth },
    plaintext: base64url.decode(vector.plaintext),
    senderKeys: await importSender(),
    salt: base64url.decode(vector.salt),
  });
  expect(base64url.encode(body)).toBe(vector.body);
});

test('fresh keys and salt produce a different body of the same shape', async () => {
  const keys = { p256dh: vector.p256dh, auth: vector.auth };
  const plaintext = base64url.decode(vector.plaintext);
  const a = await encryptPush({ keys, plaintext });
  const b = await encryptPush({ keys, plaintext });
  expect(a.length).toBe(base64url.decode(vector.body).length);
  expect(base64url.encode(a)).not.toBe(base64url.encode(b));
  expect(a[20]).toBe(65);
});

test('refuses payloads that do not fit one record', async () => {
  const keys = { p256dh: vector.p256dh, auth: vector.auth };
  await expect(encryptPush({ keys, plaintext: new Uint8Array(4079) })).rejects.toThrow(RangeError);
  await expect(encryptPush({ keys, plaintext: new Uint8Array(4078) })).resolves.toBeDefined();
});
