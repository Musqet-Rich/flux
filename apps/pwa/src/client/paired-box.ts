import type { KeyPair } from '@flux/protocol';
import { base64url, guards, handshake } from '@flux/protocol';

// What the device remembers about its box after pairing (ADR 0012): where the relay is, the
// box's static public key, the device's own keypair and the id the box gave it.

export interface PairedBoxRecord {
  relayUrl: string;
  boxPub: string;
  deviceId: string;
  devicePublic: string;
  devicePrivate: string;
}

export interface PairedBox {
  record: PairedBoxRecord;
  keys: KeyPair;
  boxPub: Uint8Array<ArrayBuffer>;
}

const { isString, isRecord } = guards;

const isRecordShape = (v: unknown): v is PairedBoxRecord =>
  isRecord(v) &&
  isString(v['relayUrl']) &&
  isString(v['boxPub']) &&
  isString(v['deviceId']) &&
  isString(v['devicePublic']) &&
  isString(v['devicePrivate']);

const load = async (value: unknown): Promise<PairedBox | null> => {
  if (!isRecordShape(value)) return null;
  const keys: KeyPair = {
    publicKey: base64url.decode(value.devicePublic),
    privateKey: await handshake.importPrivateKey(base64url.decode(value.devicePrivate)),
  };
  return { record: value, keys, boxPub: base64url.decode(value.boxPub) };
};

const create = async (
  relayUrl: string,
  boxPub: Uint8Array<ArrayBuffer>,
  keys: KeyPair,
  deviceId: string,
): Promise<PairedBox> => ({
  record: {
    relayUrl,
    boxPub: base64url.encode(boxPub),
    deviceId,
    devicePublic: base64url.encode(keys.publicKey),
    devicePrivate: base64url.encode(await handshake.exportPrivateKey(keys.privateKey)),
  },
  keys,
  boxPub,
});

export const pairedBox: { load: typeof load; create: typeof create; storageKey: string } = {
  load,
  create,
  storageKey: 'paired-box',
};
