import { base64url } from './base64url.ts';
import type { Bytes } from './bytes.ts';
import { bytes } from './bytes.ts';
import { guards } from './guards.ts';
import { ProtocolError } from './protocol-error.ts';

// Key agreement (protocol.md § 3, Handshake): static-static plus ephemeral-ephemeral X25519,
// HKDF-SHA256 over both, one AES-256-GCM key per direction. WebCrypto only.

export interface KeyPair {
  publicKey: Bytes;
  privateKey: CryptoKey;
}

export interface DeviceHello {
  v: 1;
  devPub: string;
  devEph: string;
  nonceD: string;
}

export interface BoxHello {
  v: 1;
  boxEph: string;
  nonceB: string;
}

export interface DeriveInput {
  role: 'device' | 'box';
  staticPrivate: CryptoKey;
  staticPeerPublic: Bytes;
  ephemeralPrivate: CryptoKey;
  ephemeralPeerPublic: Bytes;
  nonceD: Bytes;
  nonceB: Bytes;
  roomId: string;
}

export interface DirectionKeys {
  send: CryptoKey;
  recv: CryptoKey;
}

const keyLength = 32;
const helloNonceLength = 16;
const x25519 = { name: 'X25519' } as const;

// TypeScript's lib has no X25519 overload for generateKey, so the result is a union. Structural
// rather than the lib's CryptoKeyPair, which @types/node does not expose as a global.
interface RawKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

const isKeyPair = (key: CryptoKey | RawKeyPair): key is RawKeyPair => 'publicKey' in key;

// Static keys are extractable so the daemon and PWA can persist them; ephemerals never are.
const generateKeyPair = async (extractable = false): Promise<KeyPair> => {
  const pair = await crypto.subtle.generateKey(x25519, extractable, ['deriveBits']);
  /* v8 ignore next 3 -- X25519 always yields a pair; the check only satisfies the types. */
  if (!isKeyPair(pair)) {
    throw new ProtocolError('bad_key', 'X25519 did not produce a key pair');
  }
  return {
    publicKey: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
    privateKey: pair.privateKey,
  };
};

const exportPrivateKey = async (key: CryptoKey): Promise<Bytes> =>
  new Uint8Array(await crypto.subtle.exportKey('pkcs8', key));

const importPrivateKey = (pkcs8: Bytes): Promise<CryptoKey> =>
  crypto.subtle.importKey('pkcs8', pkcs8, x25519, true, ['deriveBits']);

const importPublicKey = (raw: Bytes): Promise<CryptoKey> => {
  if (raw.length !== keyLength) {
    return Promise.reject(new ProtocolError('bad_key', 'public key must be 32 bytes'));
  }
  return crypto.subtle.importKey('raw', raw, x25519, true, []);
};

const agree = async (privateKey: CryptoKey, peerPublic: Bytes): Promise<Bytes> =>
  new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'X25519', public: await importPublicKey(peerPublic) },
      privateKey,
      keyLength * 8,
    ),
  );

const aesKey = (raw: Bytes, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [usage]);

const derive = async (input: DeriveInput): Promise<DirectionKeys> => {
  const es = await agree(input.ephemeralPrivate, input.ephemeralPeerPublic);
  const ss = await agree(input.staticPrivate, input.staticPeerPublic);
  const ikm = await crypto.subtle.importKey('raw', bytes.concat(es, ss), 'HKDF', false, [
    'deriveBits',
  ]);
  const okm = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: bytes.concat(input.nonceD, input.nonceB),
        info: bytes.fromUtf8(`flux-v1-${input.roomId}`),
      },
      ikm,
      keyLength * 2 * 8,
    ),
  );
  const d2b = okm.slice(0, keyLength);
  const b2d = okm.slice(keyLength);
  return input.role === 'device'
    ? { send: await aesKey(d2b, 'encrypt'), recv: await aesKey(b2d, 'decrypt') }
    : { send: await aesKey(b2d, 'encrypt'), recv: await aesKey(d2b, 'decrypt') };
};

const isEncoded = (value: unknown, length: number): value is string => {
  if (!guards.isString(value)) return false;
  try {
    return base64url.decode(value).length === length;
  } catch {
    return false;
  }
};

const isDeviceHello = (value: unknown): value is DeviceHello =>
  guards.isRecord(value) &&
  value['v'] === 1 &&
  isEncoded(value['devPub'], keyLength) &&
  isEncoded(value['devEph'], keyLength) &&
  isEncoded(value['nonceD'], helloNonceLength);

const isBoxHello = (value: unknown): value is BoxHello =>
  guards.isRecord(value) &&
  value['v'] === 1 &&
  isEncoded(value['boxEph'], keyLength) &&
  isEncoded(value['nonceB'], helloNonceLength);

const nonce = (): Bytes => bytes.random(helloNonceLength);

export const handshake: {
  generateKeyPair: typeof generateKeyPair;
  exportPrivateKey: typeof exportPrivateKey;
  importPrivateKey: typeof importPrivateKey;
  derive: typeof derive;
  isDeviceHello: typeof isDeviceHello;
  isBoxHello: typeof isBoxHello;
  nonce: typeof nonce;
} = {
  generateKeyPair,
  exportPrivateKey,
  importPrivateKey,
  derive,
  isDeviceHello,
  isBoxHello,
  nonce,
};
