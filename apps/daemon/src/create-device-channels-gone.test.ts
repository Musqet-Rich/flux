import type { Bytes, Channel, Wire } from '@flux/protocol';
import {
  base64url,
  bytes,
  createChannel,
  frame,
  handshake,
  protocolVersion,
  room,
} from '@flux/protocol';
import { expect, test } from 'vitest';

import { createDeviceChannels } from './create-device-channels.ts';
import type { Device } from './create-device-store.ts';

// The command runner (ADR 0026) must hear when a device loses its last channel so it can kill any
// run the device had — no orphaned processes. `createDeviceChannels` fires `onDeviceGone` on a
// reset (a dropped relay socket), once per device, but NOT on a revoke (the revoker drives the
// runner itself and has nulled `device` by the time the channel is forgotten). The main harness
// in create-device-channels.test.ts is at its line budget, so this lives on its own.

const setup = async () => {
  const box = await handshake.generateKeyPair(true);
  const dev = await handshake.generateKeyPair(true);
  const device: Device = {
    deviceId: 'd1',
    publicKey: dev.publicKey,
    name: 'phone',
    pairedAt: 't',
    lastSeenAt: null,
  };
  const out: Bytes[] = [];
  const gone: string[] = [];
  const channels = createDeviceChannels({
    identity: { publicKey: box.publicKey, privateKey: box.privateKey },
    deviceByKey: (key) => (bytes.equals(key, dev.publicKey) ? device : null),
    pairingOpen: () => false,
    onMessage: (_peer, message) =>
      Promise.resolve(
        message.kind === 'rpc' ? { kind: 'rpc.result', id: message.id, ok: true, result: 1 } : null,
      ),
    onDeviceGone: (deviceId) => {
      gone.push(deviceId);
    },
  });
  const send = (data: Bytes): void => {
    out.push(data);
  };
  return { box, dev, channels, out, gone, send };
};

// Runs the device side of the handshake and returns its channel; a confirming frame follows.
const connect = async (h: Awaited<ReturnType<typeof setup>>): Promise<Channel> => {
  const eph = await handshake.generateKeyPair();
  const nonceD = handshake.nonce();
  const hello = {
    v: protocolVersion,
    devPub: base64url.encode(h.dev.publicKey),
    devEph: base64url.encode(eph.publicKey),
    nonceD: base64url.encode(nonceD),
  };
  const payload = bytes.fromUtf8(JSON.stringify(hello));
  await h.channels.handleFrame(frame.encode({ kind: frame.kind.handshake, payload }), h.send);
  const replyFrame = frame.decode(h.out.at(-1) ?? new Uint8Array());
  const helloB = replyFrame.kind === frame.kind.handshake ? replyFrame.payload : new Uint8Array();
  const reply: unknown = JSON.parse(bytes.toUtf8(helloB));
  if (!handshake.isBoxHello(reply)) throw new Error('no box hello');
  const keys = await handshake.derive({
    role: 'device',
    staticPrivate: h.dev.privateKey,
    staticPeerPublic: h.box.publicKey,
    ephemeralPrivate: eph.privateKey,
    ephemeralPeerPublic: base64url.decode(reply.boxEph),
    nonceD,
    nonceB: base64url.decode(reply.nonceB),
    transcript: { helloD: payload, helloB },
  });
  return createChannel({ keys, fingerprint: await room.fingerprint(h.dev.publicKey) });
};

// A device's first data frame confirms its channel (protocol.md § 3).
const confirm = async (h: Awaited<ReturnType<typeof setup>>, channel: Channel): Promise<void> => {
  const rpc: Wire = { kind: 'rpc', id: 'r1', method: 'hello', params: { protocol: 2 } };
  await h.channels.handleFrame(await channel.seal(bytes.fromUtf8(JSON.stringify(rpc))), h.send);
};

test('reset fires onDeviceGone for a connected device', async () => {
  const h = await setup();
  await confirm(h, await connect(h));
  h.channels.reset();
  expect(h.gone).toEqual(['d1']);
});

test('revoke does not fire onDeviceGone (the revoker tells the runner directly)', async () => {
  const h = await setup();
  await confirm(h, await connect(h));
  await h.channels.revoke('d1', h.send);
  expect(h.gone).toEqual([]);
});
