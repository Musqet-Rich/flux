import { base64url } from './base64url.ts';
import type { Bytes } from './bytes.ts';
import { bytes } from './bytes.ts';

// Everything the relay is allowed to know derives from `boxPub` through a hash (protocol.md § 1).

const sha256 = async (data: Bytes): Promise<Bytes> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', data));

const hmacSha256 = async (key: Bytes, message: Bytes): Promise<Bytes> => {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, message));
};

// `base64url(sha256(boxPub))[0..22]`: 132 bits, enough to never collide, short enough for a URL.
const id = async (boxPub: Bytes): Promise<string> =>
  base64url.encode(await sha256(boxPub)).slice(0, 22);

// Proves to the relay that the host slot is claimed by whoever holds `boxPub`, without revealing
// it. Guests never need this.
const token = async (boxPub: Bytes): Promise<string> => {
  const key = await sha256(bytes.concat(bytes.fromUtf8('flux-room'), boxPub));
  return base64url.encode(await hmacSha256(key, bytes.fromUtf8(await id(boxPub))));
};

// First 8 bytes of sha256(devPub); rides in the clear on every data frame so a guest can drop
// frames addressed to another device without trying to decrypt them.
const fingerprint = async (devPub: Bytes): Promise<Bytes> => (await sha256(devPub)).slice(0, 8);

export const room: {
  id: typeof id;
  token: typeof token;
  fingerprint: typeof fingerprint;
  sha256: typeof sha256;
  hmacSha256: typeof hmacSha256;
} = { id, token, fingerprint, sha256, hmacSha256 };
