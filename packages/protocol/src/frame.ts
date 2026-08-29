import type { Bytes } from './bytes.ts';
import { bytes } from './bytes.ts';
import { ProtocolError } from './protocol-error.ts';

// Binary frame layout (protocol.md § 3):
//   handshake  kind(1)=0x01 | plaintext JSON
//   data       kind(1)=0x02 | fingerprint(8) | nonce(12) | ciphertext+tag
//   compressed kind(1)=0x03 | same as data, plaintext was deflate-raw before encryption

const frameKind = { handshake: 0x01, data: 0x02, compressed: 0x03 } as const;

export type FrameKind = (typeof frameKind)[keyof typeof frameKind];

export type DataFrameKind = typeof frameKind.data | typeof frameKind.compressed;

export interface HandshakeFrame {
  kind: typeof frameKind.handshake;
  payload: Bytes;
}

export interface DataFrame {
  kind: DataFrameKind;
  fingerprint: Bytes;
  nonce: Bytes;
  ciphertext: Bytes;
}

export type Frame = HandshakeFrame | DataFrame;

const fingerprintLength = 8;
const nonceLength = 12;
const tagLength = 16;
const dataHeaderLength = 1 + fingerprintLength + nonceLength;

const encode = (frame: Frame): Bytes => {
  if (frame.kind === frameKind.handshake) {
    return bytes.concat(new Uint8Array([frame.kind]), frame.payload);
  }
  if (frame.fingerprint.length !== fingerprintLength || frame.nonce.length !== nonceLength) {
    throw new ProtocolError('bad_frame', 'fingerprint or nonce has the wrong length');
  }
  return bytes.concat(
    new Uint8Array([frame.kind]),
    frame.fingerprint,
    frame.nonce,
    frame.ciphertext,
  );
};

const decode = (data: Bytes): Frame => {
  const kind = data.length > 0 ? new DataView(data.buffer, data.byteOffset, 1).getUint8(0) : 0;
  if (kind === frameKind.handshake) return { kind, payload: data.subarray(1) };
  if (kind !== frameKind.data && kind !== frameKind.compressed) {
    throw new ProtocolError('bad_frame', `unknown frame kind ${kind}`);
  }
  if (data.length < dataHeaderLength + tagLength) {
    throw new ProtocolError('bad_frame', 'data frame too short');
  }
  return {
    kind,
    fingerprint: data.subarray(1, 1 + fingerprintLength),
    nonce: data.subarray(1 + fingerprintLength, dataHeaderLength),
    ciphertext: data.subarray(dataHeaderLength),
  };
};

// 96-bit big-endian counter. JavaScript numbers are exact to 2^53, far beyond any connection.
const nonce = (counter: number): Bytes => {
  const out = new Uint8Array(nonceLength);
  const view = new DataView(out.buffer);
  view.setUint32(4, Math.floor(counter / 2 ** 32));
  view.setUint32(8, counter >>> 0);
  return out;
};

const counterOf = (n: Bytes): number => {
  const view = new DataView(n.buffer, n.byteOffset, n.byteLength);
  return view.getUint32(4) * 2 ** 32 + view.getUint32(8);
};

export const frame: {
  kind: typeof frameKind;
  encode: typeof encode;
  decode: typeof decode;
  nonce: typeof nonce;
  counterOf: typeof counterOf;
} = { kind: frameKind, encode, decode, nonce, counterOf };
