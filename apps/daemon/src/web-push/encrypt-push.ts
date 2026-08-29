import type { Bytes } from '@flux/protocol';
import { base64url, bytes } from '@flux/protocol';

// Web Push payload encryption (RFC 8291, aes128gcm content coding of RFC 8188): ECDH between a
// fresh application-server key and the subscription's p256dh key, HKDF with the subscription's
// auth secret, one AES-128-GCM record. Output is the request body, header included.

export interface PushKeys {
  p256dh: string;
  auth: string;
}

// Structural so the daemon compiles without the DOM lib.
export interface SenderKeys {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export interface EncryptPushOptions {
  keys: PushKeys;
  plaintext: Bytes;
  // Injected by tests to reproduce the RFC 8291 example; production uses fresh values.
  senderKeys?: SenderKeys;
  salt?: Bytes;
}

const text = new TextEncoder();
const recordSize = 4096;
const maxPlaintext = recordSize - 17 - 1;

const hkdf = async (salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> => {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8),
  );
};

const generateSenderKeys = (): Promise<SenderKeys> =>
  crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);

const header = (salt: Bytes, senderPublic: Bytes): Bytes => {
  const fixed = new Uint8Array(5);
  new DataView(fixed.buffer).setUint32(0, recordSize);
  fixed[4] = senderPublic.length;
  return bytes.concat(salt, fixed, senderPublic);
};

export const encryptPush = async (options: EncryptPushOptions): Promise<Bytes> => {
  if (options.plaintext.length > maxPlaintext) {
    throw new RangeError(`push payload over ${maxPlaintext} bytes`);
  }
  const receiverPublic = base64url.decode(options.keys.p256dh);
  const auth = base64url.decode(options.keys.auth);
  const sender = options.senderKeys ?? (await generateSenderKeys());
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));
  const receiverKey = await crypto.subtle.importKey(
    'raw',
    receiverPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverKey }, sender.privateKey, 256),
  );
  const salt = options.salt ?? bytes.random(16);
  const ikm = await hkdf(
    auth,
    shared,
    bytes.concat(text.encode('WebPush: info\0'), receiverPublic, senderPublic),
    32,
  );
  const cek = await hkdf(salt, ikm, text.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, text.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // The single, last record: plaintext followed by the 0x02 delimiter and no padding.
  const record = bytes.concat(options.plaintext, new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, record),
  );
  return bytes.concat(header(salt, senderPublic), ciphertext);
};
