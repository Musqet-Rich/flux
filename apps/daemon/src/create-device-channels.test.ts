import type { Bytes, Wire } from '@flux/protocol';
import { base64url, bytes, createChannel, frame, handshake, room } from '@flux/protocol';
import { expect, test } from 'vitest';

import type { Peer } from './create-device-channels.ts';
import { createDeviceChannels } from './create-device-channels.ts';
import type { Device } from './create-device-store.ts';

// The test plays the device side of protocol.md § 3 with the protocol primitives.

const roomId = 'AAAAAAAAAAAAAAAAAAAAAA';

const setup = async (trusted: boolean, pairingOpen = false) => {
  const box = await handshake.generateKeyPair(true);
  const dev = await handshake.generateKeyPair(true);
  const device: Device = { deviceId: 'd1', publicKey: dev.publicKey, name: 'phone', pairedAt: 't' };
  const seen: { peer: Peer; message: Wire }[] = [];
  const out: Bytes[] = [];
  const send = (data: Bytes): void => {
    out.push(data);
  };
  const channels = createDeviceChannels({
    identity: { publicKey: box.publicKey, privateKey: box.privateKey },
    roomId,
    deviceByKey: (key) => (trusted && bytes.equals(key, dev.publicKey) ? device : null),
    pairingOpen: () => pairingOpen,
    onMessage: (peer, message) => {
      seen.push({ peer, message });
      return Promise.resolve(
        message.kind === 'rpc'
          ? { kind: 'rpc.result', id: message.id, ok: true, result: 42 }
          : null,
      );
    },
  });
  return { box, dev, device, channels, seen, out, send };
};

// Runs the device side of the handshake against `channels` and returns the device's channel.
const connectDevice = async (h: Awaited<ReturnType<typeof setup>>) => {
  const eph = await handshake.generateKeyPair();
  const nonceD = handshake.nonce();
  const hello = {
    v: 1,
    devPub: base64url.encode(h.dev.publicKey),
    devEph: base64url.encode(eph.publicKey),
    nonceD: base64url.encode(nonceD),
  };
  const payload = bytes.fromUtf8(JSON.stringify(hello));
  await h.channels.handleFrame(frame.encode({ kind: frame.kind.handshake, payload }), h.send);
  const replyFrame = frame.decode(h.out.at(-1) ?? new Uint8Array());
  const replyPayload =
    replyFrame.kind === frame.kind.handshake ? replyFrame.payload : new Uint8Array();
  const reply: unknown = JSON.parse(bytes.toUtf8(new Uint8Array(replyPayload)));
  if (!handshake.isBoxHello(reply)) throw new Error('no box hello');
  const keys = await handshake.derive({
    role: 'device',
    staticPrivate: h.dev.privateKey,
    staticPeerPublic: h.box.publicKey,
    ephemeralPrivate: eph.privateKey,
    ephemeralPeerPublic: base64url.decode(reply.boxEph),
    nonceD,
    nonceB: base64url.decode(reply.nonceB),
    roomId,
  });
  const fingerprint = await room.fingerprint(h.dev.publicKey);
  return { channel: createChannel({ keys, fingerprint }), reply };
};

const openWire = async (channel: ReturnType<typeof createChannel>, data: Bytes): Promise<unknown> =>
  JSON.parse(bytes.toUtf8((await channel.open(data)) ?? new Uint8Array()));

const last = (out: Bytes[]): Bytes => out.at(-1) ?? new Uint8Array();

const firstFingerprint = (h: Awaited<ReturnType<typeof setup>>): string =>
  h.channels.peers()[0]?.fingerprint ?? '';

const flipLast = (data: Bytes): Bytes => {
  const out = new Uint8Array(data);
  const view = new DataView(out.buffer);
  view.setUint8(out.length - 1, view.getUint8(out.length - 1) ^ 1);
  return out;
};

test('a trusted device handshakes, sends an rpc and gets the reply', async () => {
  const h = await setup(true);
  const { channel, reply } = await connectDevice(h);
  expect(reply).toMatchObject({ v: 1, to: expect.any(String) });
  expect(h.channels.peers()).toMatchObject([{ device: { deviceId: 'd1' } }]);
  const rpc: Wire = { kind: 'rpc', id: 'r1', method: 'sessions.list', params: {} };
  await h.channels.handleFrame(await channel.seal(bytes.fromUtf8(JSON.stringify(rpc))), h.send);
  expect(h.seen).toHaveLength(1);
  expect(h.seen[0]?.peer.device?.deviceId).toBe('d1');
  expect(await openWire(channel, last(h.out))).toEqual({
    kind: 'rpc.result',
    id: 'r1',
    ok: true,
    result: 42,
  });
});

test('broadcast and sendTo reach the device, unknown fingerprints are refused', async () => {
  const h = await setup(true);
  const { channel } = await connectDevice(h);
  const event: Wire = {
    kind: 'event',
    event: { seq: 1, ts: 't', session: 's', type: 'msg.assistant', payload: { text: 'hi' } },
  };
  await h.channels.broadcast(event, h.send);
  expect(await openWire(channel, last(h.out))).toEqual(event);
  expect(await h.channels.sendTo(firstFingerprint(h), event, h.send)).toBe(true);
  expect(await openWire(channel, last(h.out))).toEqual(event);
  expect(await h.channels.sendTo('nope', event, h.send)).toBe(false);
});

test('an unknown device is ignored unless pairing is open', async () => {
  const closed = await setup(false);
  await expect(connectDevice(closed)).rejects.toThrow(/unknown frame kind|no box hello/u);
  expect(closed.channels.peers()).toEqual([]);
  const open = await setup(false, true);
  await connectDevice(open);
  expect(open.channels.peers()).toMatchObject([{ device: null }]);
});

test('garbage, bad frames and unknown senders are dropped silently', async () => {
  const h = await setup(true);
  await h.channels.handleFrame(new Uint8Array([9, 9]), h.send);
  await h.channels.handleFrame(
    frame.encode({ kind: frame.kind.handshake, payload: bytes.fromUtf8('nope') }),
    h.send,
  );
  await h.channels.handleFrame(
    frame.encode({ kind: frame.kind.handshake, payload: bytes.fromUtf8('{"v":1}') }),
    h.send,
  );
  const stray = frame.encode({
    kind: frame.kind.data,
    fingerprint: new Uint8Array(8),
    nonce: frame.nonce(0),
    ciphertext: new Uint8Array(20),
  });
  await h.channels.handleFrame(stray, h.send);
  expect(h.out).toEqual([]);
  const { channel } = await connectDevice(h);
  const before = h.out.length;
  await h.channels.handleFrame(await channel.seal(bytes.fromUtf8('not json')), h.send);
  await h.channels.handleFrame(await channel.seal(bytes.fromUtf8('{"kind":"nope"}')), h.send);
  const tampered = flipLast(await channel.seal(bytes.fromUtf8('{"kind":"rpc"}')));
  await h.channels.handleFrame(tampered, h.send);
  expect(h.out).toHaveLength(before);
  expect(h.seen).toEqual([]);
  h.channels.reset();
  expect(h.channels.peers()).toEqual([]);
});
