import type { Bytes, Channel, KeyPair } from '@flux/protocol';
import { base64url, bytes, createChannel, frame, handshake, room } from '@flux/protocol';

import { ClientError } from './client-error.ts';

// The device side of protocol.md § 3: `hello` builds the frame to send; `complete` turns the
// box's reply into a channel. Between them the caller owns the socket.

export interface DeviceHandshake {
  frame: Bytes;
  fingerprint: string;
  complete: (reply: Bytes) => Promise<Channel | null>;
}

export interface DeviceHandshakeOptions {
  keys: KeyPair;
  boxPub: Bytes;
  roomId: string;
}

export const deviceHandshake = async (
  options: DeviceHandshakeOptions,
): Promise<DeviceHandshake> => {
  const eph = await handshake.generateKeyPair();
  const nonceD = handshake.nonce();
  const fingerprintBytes = await room.fingerprint(options.keys.publicKey);
  const fingerprint = base64url.encode(fingerprintBytes);
  const hello = {
    v: 1,
    devPub: base64url.encode(options.keys.publicKey),
    devEph: base64url.encode(eph.publicKey),
    nonceD: base64url.encode(nonceD),
  };
  return {
    frame: frame.encode({
      kind: frame.kind.handshake,
      payload: bytes.fromUtf8(JSON.stringify(hello)),
    }),
    fingerprint,
    // `null` when the reply is a box hello for another guest in the room.
    complete: async (data) => {
      const decoded = frame.decode(data);
      if (decoded.kind !== frame.kind.handshake) {
        throw new ClientError('bad_reply', 'expected a handshake frame');
      }
      const reply: unknown = JSON.parse(bytes.toUtf8(new Uint8Array(decoded.payload)));
      if (!handshake.isBoxHello(reply)) throw new ClientError('bad_reply', 'expected a box hello');
      if (reply.to !== fingerprint) return null;
      const keys = await handshake.derive({
        role: 'device',
        staticPrivate: options.keys.privateKey,
        staticPeerPublic: options.boxPub,
        ephemeralPrivate: eph.privateKey,
        ephemeralPeerPublic: base64url.decode(reply.boxEph),
        nonceD,
        nonceB: base64url.decode(reply.nonceB),
        roomId: options.roomId,
      });
      return createChannel({ keys, fingerprint: fingerprintBytes });
    },
  };
};
