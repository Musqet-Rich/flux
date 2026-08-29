import { base64url } from './base64url.ts';
import type { Bytes } from './bytes.ts';
import { bytes } from './bytes.ts';
import { room } from './room.ts';

// Pairing URL and proof (protocol.md § 1, ADR 0012). The payload lives in the fragment so it
// never reaches the relay's access log.

export interface PairingPayload {
  boxPub: Bytes;
  secret: Bytes;
}

const keyLength = 32;
const secretLength = 16;

const url = (relayOrigin: string, payload: PairingPayload): string =>
  `${relayOrigin}/#${base64url.encode(payload.boxPub)}.${base64url.encode(payload.secret)}`;

// `null` for anything that is not a well-formed pairing fragment; the PWA treats that as
// "no pairing requested" rather than an error, since any URL can carry any fragment.
const parse = (fragment: string): PairingPayload | null => {
  const [pub, secret, ...rest] = fragment.replace(/^#/u, '').split('.');
  if (pub === undefined || secret === undefined || rest.length > 0) return null;
  try {
    const payload = { boxPub: base64url.decode(pub), secret: base64url.decode(secret) };
    return payload.boxPub.length === keyLength && payload.secret.length === secretLength
      ? payload
      : null;
  } catch {
    return null;
  }
};

// HMAC-SHA256(secret, devPub || boxPub): possession of the one-time secret, bound to both keys.
const proof = (secret: Bytes, devPub: Bytes, boxPub: Bytes): Promise<Bytes> =>
  room.hmacSha256(secret, bytes.concat(devPub, boxPub));

const verify = async (
  secret: Bytes,
  devPub: Bytes,
  boxPub: Bytes,
  candidate: Bytes,
): Promise<boolean> => bytes.equals(await proof(secret, devPub, boxPub), candidate);

export const pairing: {
  url: typeof url;
  parse: typeof parse;
  proof: typeof proof;
  verify: typeof verify;
  secretLength: number;
} = { url, parse, proof, verify, secretLength };
