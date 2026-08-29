import type { Bytes, Channel, KeyPair } from '@flux/protocol';
import { base64url, bytes, createChannel, frame, handshake, room } from '@flux/protocol';

// The device side of protocol.md § 3 for tests: sends the hello, waits for the box's reply and
// returns the derived channel. `next` yields the next binary frame the device receives.

export interface DeviceSide {
  keys: KeyPair;
  boxPub: Bytes;
  roomId: string;
  send: (data: Bytes) => void;
  next: () => Promise<Bytes>;
}

export const deviceHandshake = async (side: DeviceSide): Promise<Channel> => {
  const eph = await handshake.generateKeyPair();
  const nonceD = handshake.nonce();
  const hello = {
    v: 1,
    devPub: base64url.encode(side.keys.publicKey),
    devEph: base64url.encode(eph.publicKey),
    nonceD: base64url.encode(nonceD),
  };
  side.send(
    frame.encode({ kind: frame.kind.handshake, payload: bytes.fromUtf8(JSON.stringify(hello)) }),
  );
  const replyFrame = frame.decode(await side.next());
  if (replyFrame.kind !== frame.kind.handshake) throw new Error('expected a handshake frame');
  const reply: unknown = JSON.parse(bytes.toUtf8(new Uint8Array(replyFrame.payload)));
  if (!handshake.isBoxHello(reply)) throw new Error('expected a box hello');
  const keys = await handshake.derive({
    role: 'device',
    staticPrivate: side.keys.privateKey,
    staticPeerPublic: side.boxPub,
    ephemeralPrivate: eph.privateKey,
    ephemeralPeerPublic: base64url.decode(reply.boxEph),
    nonceD,
    nonceB: base64url.decode(reply.nonceB),
    roomId: side.roomId,
  });
  return createChannel({ keys, fingerprint: await room.fingerprint(side.keys.publicKey) });
};
