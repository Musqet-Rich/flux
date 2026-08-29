import { expect, test } from 'vitest';

import type { Bytes } from './bytes.ts';
import { bytes } from './bytes.ts';
import { createChannel } from './create-channel.ts';
import { frame } from './frame.ts';
import { handshake } from './handshake.ts';
import { ProtocolError } from './protocol-error.ts';

const fingerprint = new Uint8Array(8).map((_, i) => i);
// Byte offsets from the frame layout: kind(1) | fingerprint(8) | nonce(12).
const flip = (data: Bytes, index: number): Bytes => {
  const out = new Uint8Array(data);
  const view = new DataView(out.buffer);
  view.setUint8(index, view.getUint8(index) ^ 0xff);
  return out;
};
const lengthOf = (opened: Bytes | null): number => (opened === null ? -1 : opened.length);
const nonceAt = (sealed: Bytes): number => frame.counterOf(sealed.subarray(9, 21));

// Two channels sharing one key agreement, as the box and a device would after the handshake.
const pair = async (compressAbove?: number) => {
  const boxStatic = await handshake.generateKeyPair();
  const devStatic = await handshake.generateKeyPair();
  const boxEph = await handshake.generateKeyPair();
  const devEph = await handshake.generateKeyPair();
  const common = { nonceD: handshake.nonce(), nonceB: handshake.nonce(), roomId: 'r' };
  const deviceKeys = await handshake.derive({
    ...common,
    role: 'device',
    staticPrivate: devStatic.privateKey,
    staticPeerPublic: boxStatic.publicKey,
    ephemeralPrivate: devEph.privateKey,
    ephemeralPeerPublic: boxEph.publicKey,
  });
  const boxKeys = await handshake.derive({
    ...common,
    role: 'box',
    staticPrivate: boxStatic.privateKey,
    staticPeerPublic: devStatic.publicKey,
    ephemeralPrivate: boxEph.privateKey,
    ephemeralPeerPublic: devEph.publicKey,
  });
  const opts = compressAbove === undefined ? {} : { compressAbove };
  return {
    device: createChannel({ keys: deviceKeys, fingerprint, ...opts }),
    box: createChannel({ keys: boxKeys, fingerprint, ...opts }),
  };
};

test('seals in one direction and opens in the other', async () => {
  const { device, box } = await pair();
  const text = bytes.fromUtf8('{"kind":"rpc"}');
  expect(await box.open(await device.seal(text))).toEqual(text);
  expect(await device.open(await box.seal(text))).toEqual(text);
});

test('small payloads are sent as plain data frames, large ones compressed', async () => {
  const { device } = await pair();
  const small = frame.decode(await device.seal(new Uint8Array(1024)));
  const large = frame.decode(await device.seal(new Uint8Array(1025)));
  expect(small.kind).toBe(frame.kind.data);
  expect(large.kind).toBe(frame.kind.compressed);
});

test('compressed frames round-trip and are smaller on the wire', async () => {
  const { device, box } = await pair(16);
  const text = bytes.fromUtf8('diff --git a/x b/x\n'.repeat(50));
  const sealed = await device.seal(text);
  expect(sealed.length).toBeLessThan(text.length);
  expect(await box.open(sealed)).toEqual(text);
});

test('nonces count up per direction from zero', async () => {
  const { device } = await pair();
  const first = await device.seal(new Uint8Array(1));
  const second = await device.seal(new Uint8Array(1));
  expect(nonceAt(first)).toBe(0);
  expect(nonceAt(second)).toBe(1);
});

test('a replayed or reordered frame is rejected', async () => {
  const { device, box } = await pair();
  const first = await device.seal(new Uint8Array([1]));
  const second = await device.seal(new Uint8Array([2]));
  await box.open(second);
  await expect(box.open(second)).rejects.toThrow(ProtocolError);
  await expect(box.open(first)).rejects.toMatchObject({ code: 'bad_nonce' });
});

test('a frame for another device is ignored, not an error', async () => {
  const { device, box } = await pair();
  const sealed = await device.seal(new Uint8Array([1]));
  expect(await box.open(flip(sealed, 1))).toBeNull();
});

test('a tampered frame fails authentication and does not advance the counter', async () => {
  const { device, box } = await pair();
  const sealed = await device.seal(new Uint8Array([1]));
  const tampered = flip(sealed, sealed.length - 1);
  await expect(box.open(tampered)).rejects.toMatchObject({ code: 'decrypt_failed' });
  expect(await box.open(sealed)).toEqual(new Uint8Array([1]));
});

test('frames sealed with the wrong direction key are rejected', async () => {
  const { device } = await pair();
  const sealed = await device.seal(new Uint8Array([1]));
  await expect(device.open(sealed)).rejects.toMatchObject({ code: 'decrypt_failed' });
});

test('a handshake frame on an open channel is a protocol error', async () => {
  const { box } = await pair();
  const hs = frame.encode({ kind: frame.kind.handshake, payload: new Uint8Array([1]) });
  await expect(box.open(hs)).rejects.toMatchObject({ code: 'bad_frame' });
});

test('concurrent seals leave in counter order and concurrent opens accept them', async () => {
  const { box, device } = await pair();
  const sealed = await Promise.all([1, 2, 3, 4].map((n) => box.seal(new Uint8Array(n * 300))));
  expect(sealed.map((s) => nonceAt(s))).toEqual([0, 1, 2, 3]);
  const opened = await Promise.all(sealed.map((s) => device.open(s)));
  expect(opened.map((o) => lengthOf(o))).toEqual([300, 600, 900, 1200]);
});
