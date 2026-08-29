import type { Bytes, Wire } from '@flux/protocol';
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

import type { Peer } from './create-device-channels.ts';
import { createDeviceChannels } from './create-device-channels.ts';
import type { Device } from './create-device-store.ts';

// The test plays the device side of protocol.md § 3 with the protocol primitives.

const setup = async (trusted: boolean, pairingOpen = false) => {
  const box = await handshake.generateKeyPair(true);
  const dev = await handshake.generateKeyPair(true);
  const device: Device = {
    deviceId: 'd1',
    publicKey: dev.publicKey,
    name: 'phone',
    pairedAt: 't',
    lastSeenAt: null,
  };
  const seen: { peer: Peer; message: Wire }[] = [];
  const out: Bytes[] = [];
  const send = (data: Bytes): void => {
    out.push(data);
  };
  // What a handler does before answering; a test swaps it to revoke mid-call.
  const hooks = { beforeReply: (): Promise<void> => Promise.resolve() };
  const channels = createDeviceChannels({
    identity: { publicKey: box.publicKey, privateKey: box.privateKey },
    deviceByKey: (key) => (trusted && bytes.equals(key, dev.publicKey) ? device : null),
    pairingOpen: () => pairingOpen,
    onMessage: async (peer, message) => {
      seen.push({ peer, message });
      await hooks.beforeReply();
      return message.kind === 'rpc'
        ? { kind: 'rpc.result', id: message.id, ok: true, result: 42 }
        : null;
    },
  });
  return { box, dev, device, channels, seen, out, send, hooks };
};

// Runs the device side of the handshake against `channels` and returns the device's channel.
// `v` is the version the device claims; `tamper` rewrites the box hello before the device
// derives from it, as a relay in the middle could.
const connectDevice = async (
  h: Awaited<ReturnType<typeof setup>>,
  v = protocolVersion,
  tamper = (helloB: Bytes): Bytes => helloB,
) => {
  const eph = await handshake.generateKeyPair();
  const nonceD = handshake.nonce();
  const hello = {
    v,
    devPub: base64url.encode(h.dev.publicKey),
    devEph: base64url.encode(eph.publicKey),
    nonceD: base64url.encode(nonceD),
  };
  const payload = bytes.fromUtf8(JSON.stringify(hello));
  await h.channels.handleFrame(frame.encode({ kind: frame.kind.handshake, payload }), h.send);
  const replyFrame = frame.decode(h.out.at(-1) ?? new Uint8Array());
  const replyPayload =
    replyFrame.kind === frame.kind.handshake ? replyFrame.payload : new Uint8Array();
  const helloB = tamper(new Uint8Array(replyPayload));
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
  const fingerprint = await room.fingerprint(h.dev.publicKey);
  return { channel: createChannel({ keys, fingerprint }), reply };
};

const openWire = async (channel: ReturnType<typeof createChannel>, data: Bytes): Promise<unknown> =>
  JSON.parse(bytes.toUtf8((await channel.open(data)) ?? new Uint8Array()));

const last = (out: Bytes[]): Bytes => out.at(-1) ?? new Uint8Array();
const nth = (out: Bytes[], n: number): Bytes => out.at(n) ?? new Uint8Array();

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
  expect(reply).toMatchObject({ v: protocolVersion, to: expect.any(String) });
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
    frame.encode({ kind: frame.kind.handshake, payload: bytes.fromUtf8('{"v":2}') }),
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

// The device on another protocol version is answered with the box's version, so it can say
// which side to update, but is given no channel: its first frame is dropped unanswered.
test('a device on another protocol version gets the box hello and no channel', async () => {
  const h = await setup(true);
  const { channel, reply } = await connectDevice(h, 1);
  expect(reply).toMatchObject({ v: protocolVersion });
  expect(h.channels.peers()).toEqual([]);
  await h.channels.handleFrame(await rpcFrame(channel), h.send);
  expect(h.out).toHaveLength(1);
  expect(h.seen).toEqual([]);
});

// A box hello with a space added after `v`: it parses the same, its bytes differ.
const respace = (helloB: Bytes): Bytes => {
  const text = bytes.toUtf8(helloB);
  expect(text).toContain('{"v":2,');
  return bytes.fromUtf8(text.replace('{"v":2,', '{"v":2, '));
};

// Key confirmation (protocol.md § 3): the device's first data frame must open, or the channel
// its handshake made is dropped. A relay that rewrote the box hello on the way (here only its
// whitespace: the fields parse the same, the bytes differ) gives the two sides different keys;
// the box must not keep that channel around, and must not drop the device's other, working
// channel over it.
test('a first frame that fails to open drops the unconfirmed channel only', async () => {
  const h = await setup(true);
  const { channel: good } = await connectDevice(h);
  await h.channels.handleFrame(await rpcFrame(good), h.send);
  const { channel: bad } = await connectDevice(h, protocolVersion, respace);
  const before = h.out.length;
  await h.channels.handleFrame(await rpcFrame(bad), h.send);
  expect(h.out).toHaveLength(before);
  // Once dropped, even the device's own later frames on that channel are never tried.
  await h.channels.handleFrame(await rpcFrame(bad), h.send);
  await h.channels.handleFrame(await rpcFrame(good), h.send);
  expect(h.seen).toHaveLength(2);
  expect(await openWire(good, last(h.out))).toMatchObject({ kind: 'rpc.result', id: 'r2' });
  await h.channels.broadcast(assistant(1, 'x'), h.send);
  // One sealed copy: the good channel is the device's only channel now.
  expect(h.out).toHaveLength(before + 2);
});

// A confirmed channel is never dropped by a failed frame: a stray frame with nonce 0 for the
// device's fingerprint (a corrupted one, or a stranger's guess) costs the device nothing.
test('a stray first frame does not drop a confirmed channel', async () => {
  const h = await setup(true);
  const { channel } = await connectDevice(h);
  await h.channels.handleFrame(await rpcFrame(channel), h.send);
  const stray = frame.encode({
    kind: frame.kind.data,
    fingerprint: await room.fingerprint(h.dev.publicKey),
    nonce: frame.nonce(0),
    ciphertext: new Uint8Array(20),
  });
  await h.channels.handleFrame(stray, h.send);
  expect(h.channels.peers()).toHaveLength(1);
  await h.channels.handleFrame(await rpcFrame(channel), h.send);
  expect(h.seen).toHaveLength(2);
});

const assistant = (seq: number, text: string): Wire => ({
  kind: 'event',
  event: { seq, ts: 't', session: 's', type: 'msg.assistant', payload: { text } },
});

// A channel numbers frames as it seals them, so a reply sealed after a broadcast must leave
// after it. The first device's channel is given a backlog of large frames so its share of the
// broadcast is slow; the second device's reply must still not overtake the broadcast on its
// own channel, which it did when the broadcast sealed for everyone before sending to anyone.
test('a reply sealed behind a broadcast never overtakes it on its device', async () => {
  const h = await setup(true, true);
  await connectDevice(h);
  const { channel: second } = await connectDevice({
    ...h,
    dev: await handshake.generateKeyPair(true),
  });
  const [first = '', secondFp = ''] = h.channels.peers().map((peer) => peer.fingerprint);
  const big = assistant(1, 'x'.repeat(256 * 1024));
  const result: Wire = { kind: 'rpc.result', id: 'r', ok: true, result: null };
  await Promise.all([
    h.channels.sendTo(first, big, h.send),
    h.channels.sendTo(first, big, h.send),
    h.channels.sendTo(first, big, h.send),
    h.channels.broadcast(assistant(2, 'event'), h.send),
    h.channels.sendTo(secondFp, result, h.send),
  ]);
  const frames = h.out.filter((data) => frame.decode(data).kind !== frame.kind.handshake);
  const opened = await Promise.all(frames.map((data) => second.open(data)));
  const seen = opened
    .filter((plain) => plain !== null)
    .map((plain): unknown => JSON.parse(bytes.toUtf8(plain)));
  expect(seen).toEqual([assistant(2, 'event'), result]);
});

const revoked: Wire = { kind: 'ephemeral', data: { type: 'device.revoked', deviceId: 'd1' } };
const rpcFrame = (channel: ReturnType<typeof createChannel>): Promise<Bytes> =>
  channel.seal(
    bytes.fromUtf8(JSON.stringify({ kind: 'rpc', id: 'r2', method: 'sessions.list', params: {} })),
  );

test('a revoked device is told once, then ignored; unknown ids are a no-op', async () => {
  const h = await setup(true);
  const { channel } = await connectDevice(h);
  await h.channels.revoke('nobody', h.send);
  expect(h.channels.peers()).toHaveLength(1);
  await h.channels.revoke('d1', h.send);
  expect(await openWire(channel, last(h.out))).toEqual(revoked);
  expect(h.channels.peers()).toEqual([]);
  const before = h.out.length;
  await h.channels.handleFrame(await rpcFrame(channel), h.send);
  expect(h.out).toHaveLength(before);
  expect(h.seen).toEqual([]);
});

test('revocation while an rpc is in flight drops later frames and strips the device', async () => {
  const h = await setup(true);
  const { channel } = await connectDevice(h);
  const gate = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  h.hooks.beforeReply = () => {
    entered.resolve();
    return gate.promise;
  };
  const inFlight = h.channels.handleFrame(await rpcFrame(channel), h.send);
  await entered.promise;
  await h.channels.revoke('d1', h.send);
  // Still connected until the answer is out, but already a stranger to every handler.
  expect(h.channels.peers()).toMatchObject([{ device: null }]);
  expect(h.seen[0]?.peer.device).toBeNull();
  const before = h.out.length;
  await h.channels.handleFrame(await rpcFrame(channel), h.send);
  expect(h.out).toHaveLength(before);
  expect(h.seen).toHaveLength(1);
  gate.resolve();
  await inFlight;
  expect(h.channels.peers()).toEqual([]);
  expect(await openWire(channel, nth(h.out, -2))).toMatchObject({ kind: 'rpc.result', id: 'r2' });
  expect(await openWire(channel, last(h.out))).toEqual(revoked);
});

test('a device removing itself gets the answer before the notice', async () => {
  const h = await setup(true);
  const { channel } = await connectDevice(h);
  h.hooks.beforeReply = () => h.channels.revoke('d1', h.send);
  await h.channels.handleFrame(await rpcFrame(channel), h.send);
  expect(await openWire(channel, nth(h.out, -2))).toMatchObject({
    kind: 'rpc.result',
    id: 'r2',
    ok: true,
  });
  expect(await openWire(channel, last(h.out))).toEqual(revoked);
  expect(h.channels.peers()).toEqual([]);
});

const opensOn = async (channel: ReturnType<typeof createChannel>, frames: Bytes[]) => {
  const opened = await Promise.all(frames.map((data) => channel.open(data).catch(() => null)));
  return opened.filter((plain) => plain !== null).length;
};

// Two tabs of one browser profile share the device's static key and so its fingerprint, but
// each handshake derives its own keys: the box keeps a channel per handshake and a frame
// from one tab opens only on that tab's channel. Channels seal in parallel, so a pair of
// frames is checked as a pair rather than by position.
test('two tabs of one device each get their own channel and both stay connected', async () => {
  const h = await setup(true);
  const { channel: a } = await connectDevice(h);
  const { channel: b } = await connectDevice(h);
  expect(h.channels.peers()).toMatchObject([{ device: { deviceId: 'd1' } }]);
  await h.channels.broadcast(assistant(1, 'hi'), h.send);
  expect(h.out).toHaveLength(4);
  expect(await opensOn(a, h.out.slice(-2))).toBe(1);
  expect(await opensOn(b, h.out.slice(-2))).toBe(1);
  expect(await h.channels.sendTo(firstFingerprint(h), assistant(2, 'yo'), h.send)).toBe(true);
  expect(h.out).toHaveLength(6);
  expect(await opensOn(a, h.out.slice(-2))).toBe(1);
  expect(await opensOn(b, h.out.slice(-2))).toBe(1);
  await h.channels.handleFrame(await rpcFrame(a), h.send);
  await h.channels.handleFrame(await rpcFrame(b), h.send);
  expect(h.seen).toHaveLength(2);
  expect(await openWire(a, nth(h.out, -2))).toMatchObject({ kind: 'rpc.result', id: 'r2' });
  expect(await openWire(b, last(h.out))).toMatchObject({ kind: 'rpc.result', id: 'r2' });
  await expect(a.open(last(h.out))).rejects.toThrow(/authentication failed|already seen/u);
  await expect(b.open(nth(h.out, -2))).rejects.toThrow(/authentication failed|already seen/u);
});

test('revoking a device cuts every tab; one tab going quiet leaves the other working', async () => {
  const h = await setup(true);
  const { channel: a } = await connectDevice(h);
  const { channel: b } = await connectDevice(h);
  await h.channels.handleFrame(await rpcFrame(b), h.send);
  expect(await openWire(b, last(h.out))).toMatchObject({ kind: 'rpc.result', id: 'r2' });
  await h.channels.revoke('d1', h.send);
  expect(h.channels.peers()).toEqual([]);
  // The notices are sealed in parallel, so each tab finds its own among the last two.
  expect(await opensOn(a, h.out.slice(-2))).toBe(1);
  expect(await opensOn(b, h.out.slice(-2))).toBe(1);
  const before = h.out.length;
  await h.channels.handleFrame(await rpcFrame(a), h.send);
  await h.channels.handleFrame(await rpcFrame(b), h.send);
  expect(h.out).toHaveLength(before);
});

// The relay's guest cap (protocol.md § 2) bounds the channels the box keeps per device.
const guestCap = 8;

// The relay never tells the host that a guest left, so a closed tab's channel lingers until
// the device handshakes past the relay's guest cap; then the channel heard from least recently
// is dropped, which is never one that has spoken since the others arrived.
test('past the per-device cap the quietest channel is dropped', async () => {
  const h = await setup(true);
  const { channel: first } = await connectDevice(h);
  const { channel: second } = await connectDevice(h);
  await h.channels.handleFrame(await rpcFrame(first), h.send);
  const later = await Promise.all(Array.from({ length: guestCap - 1 }, () => connectDevice(h)));
  await h.channels.broadcast(assistant(1, 'x'), h.send);
  const frames = h.out.slice(-guestCap);
  expect(await opensOn(first, frames)).toBe(1);
  expect(await opensOn(second, frames)).toBe(0);
  const forLater = await Promise.all(later.map((tab) => opensOn(tab.channel, frames)));
  expect(forLater).toEqual(later.map(() => 1));
  expect(h.channels.peers()).toHaveLength(1);
});
