import type { Bytes, Channel, KeyPair } from '@flux/protocol';
import {
  base64url,
  bytes,
  createChannel,
  frame,
  handshake,
  protocolVersion,
  room,
} from '@flux/protocol';

import { ClientError } from './client-error.ts';

// The device side of protocol.md § 3: `hello` builds the frame to send; `complete` turns the
// box's reply into a channel. Between them the caller owns the socket. The keys bind both hellos
// exactly as they went over the wire, so the bytes sent are kept, never rebuilt.

export interface DeviceHandshake {
  frame: Bytes;
  fingerprint: string;
  complete: (reply: Bytes) => Promise<Channel | null>;
}

export interface DeviceHandshakeOptions {
  keys: KeyPair;
  boxPub: Bytes;
}

const badVersion = (boxVersion: number): string =>
  boxVersion < protocolVersion
    ? `Box is on protocol ${boxVersion}; update it`
    : `Box is on protocol ${boxVersion}; update this app`;

export const deviceHandshake = async (
  options: DeviceHandshakeOptions,
): Promise<DeviceHandshake> => {
  const eph = await handshake.generateKeyPair();
  const nonceD = handshake.nonce();
  const fingerprintBytes = await room.fingerprint(options.keys.publicKey);
  const fingerprint = base64url.encode(fingerprintBytes);
  const hello = {
    v: protocolVersion,
    devPub: base64url.encode(options.keys.publicKey),
    devEph: base64url.encode(eph.publicKey),
    nonceD: base64url.encode(nonceD),
  };
  const helloD = bytes.fromUtf8(JSON.stringify(hello));
  return {
    frame: frame.encode({ kind: frame.kind.handshake, payload: helloD }),
    fingerprint,
    // `null` when the frame is not our reply: a box hello for another guest in the room, or
    // a data frame the box sent another guest (another tab of this device included) while
    // we wait; the relay broadcasts both to everyone.
    complete: async (data) => {
      const decoded = frame.decode(data);
      if (decoded.kind !== frame.kind.handshake) return null;
      const helloB = new Uint8Array(decoded.payload);
      const reply: unknown = JSON.parse(bytes.toUtf8(helloB));
      if (!handshake.isBoxHello(reply)) throw new ClientError('bad_reply', 'expected a box hello');
      if (reply.to !== fingerprint) return null;
      // A box on another version answers with its own (protocol.md § 8) and derives nothing;
      // saying so beats a channel that never decrypts.
      if (reply.v !== protocolVersion) throw new ClientError('bad_version', badVersion(reply.v));
      const keys = await handshake.derive({
        role: 'device',
        staticPrivate: options.keys.privateKey,
        staticPeerPublic: options.boxPub,
        ephemeralPrivate: eph.privateKey,
        ephemeralPeerPublic: base64url.decode(reply.boxEph),
        nonceD,
        nonceB: base64url.decode(reply.nonceB),
        transcript: { helloD, helloB },
      });
      return createChannel({ keys, fingerprint: fingerprintBytes });
    },
  };
};
