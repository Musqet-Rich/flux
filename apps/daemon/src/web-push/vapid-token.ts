import type { Bytes } from '@flux/protocol';
import { base64url } from '@flux/protocol';

// VAPID (RFC 8292): a short-lived ES256 JWT identifying the box to the push service, carried in
// the Authorization header together with the raw public key.

export interface VapidKeys {
  publicKey: Bytes;
  privateKey: CryptoKey;
}

export interface VapidTokenOptions {
  keys: VapidKeys;
  endpoint: string;
  subject: string;
  now?: number;
}

const text = new TextEncoder();
const lifetimeSeconds = 12 * 60 * 60;

const segment = (value: unknown): string => base64url.encode(text.encode(JSON.stringify(value)));

export const vapidToken = async (options: VapidTokenOptions): Promise<string> => {
  const now = options.now ?? Date.now();
  const claims = {
    aud: new URL(options.endpoint).origin,
    exp: Math.floor(now / 1000) + lifetimeSeconds,
    sub: options.subject,
  };
  const signingInput = `${segment({ typ: 'JWT', alg: 'ES256' })}.${segment(claims)}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      options.keys.privateKey,
      text.encode(signingInput),
    ),
  );
  const jwt = `${signingInput}.${base64url.encode(signature)}`;
  return `vapid t=${jwt}, k=${base64url.encode(options.keys.publicKey)}`;
};
