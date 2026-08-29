import type { Bytes } from './bytes.ts';
import { bytes } from './bytes.ts';
import { compress } from './compress.ts';
import type { DataFrameKind } from './frame.ts';
import { frame } from './frame.ts';
import type { DirectionKeys } from './handshake.ts';
import { ProtocolError } from './protocol-error.ts';

// One encrypted channel between the box and one device (protocol.md § 3). Nonces are per-direction
// counters; a receiver refuses anything at or below the last counter it accepted, so replays and
// reordering within a connection are rejected outright.

export interface Channel {
  seal: (plaintext: Bytes) => Promise<Bytes>;
  // `null` means "not addressed to this device": the fingerprint did not match, so nothing was
  // attempted. Every other failure throws.
  open: (data: Bytes) => Promise<Bytes | null>;
}

export interface ChannelOptions {
  keys: DirectionKeys;
  fingerprint: Bytes;
  // Payloads above this many bytes are deflated before encryption. Tests lower it.
  compressAbove?: number;
}

const defaultCompressAbove = 1024;

const aad = (kind: DataFrameKind, fingerprint: Bytes): Bytes =>
  bytes.concat(new Uint8Array([kind]), fingerprint);

export const createChannel = (options: ChannelOptions): Channel => {
  const { keys, fingerprint } = options;
  const compressAbove = options.compressAbove ?? defaultCompressAbove;
  let sendCounter = 0;
  let lastReceived = -1;

  const seal = async (plaintext: Bytes): Promise<Bytes> => {
    const compressed = plaintext.length > compressAbove;
    const kind = compressed ? frame.kind.compressed : frame.kind.data;
    const body = compressed ? await compress.deflate(plaintext) : plaintext;
    const nonce = frame.nonce(sendCounter++);
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: aad(kind, fingerprint) },
        keys.send,
        body,
      ),
    );
    return frame.encode({ kind, fingerprint, nonce, ciphertext });
  };

  const open = async (data: Bytes): Promise<Bytes | null> => {
    const decoded = frame.decode(data);
    if (decoded.kind === frame.kind.handshake) {
      throw new ProtocolError('bad_frame', 'handshake frame on an open channel');
    }
    if (!bytes.equals(decoded.fingerprint, fingerprint)) return null;
    const counter = frame.counterOf(decoded.nonce);
    if (counter <= lastReceived) {
      throw new ProtocolError('bad_nonce', `nonce ${counter} already seen`);
    }
    let body: Bytes;
    try {
      body = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: decoded.nonce, additionalData: aad(decoded.kind, fingerprint) },
          keys.recv,
          decoded.ciphertext,
        ),
      );
    } catch {
      throw new ProtocolError('decrypt_failed', 'authentication failed');
    }
    lastReceived = counter;
    return decoded.kind === frame.kind.compressed ? compress.inflate(body) : body;
  };

  return { seal, open };
};
