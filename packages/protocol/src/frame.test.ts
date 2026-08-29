import { expect, test } from 'vitest';

import { frame } from './frame.ts';
import { ProtocolError } from './protocol-error.ts';

const fingerprint = new Uint8Array(8).map((_, i) => i + 1);
const ciphertext = new Uint8Array(20).map((_, i) => 100 + i);
const zeros = (n: number): number[] => Array.from({ length: n }, () => 0);

test('handshake frame is kind byte plus payload', () => {
  const payload = new Uint8Array([9, 8, 7]);
  const encoded = frame.encode({ kind: frame.kind.handshake, payload });
  expect([...encoded]).toEqual([1, 9, 8, 7]);
  expect(frame.decode(encoded)).toEqual({ kind: frame.kind.handshake, payload });
});

test.each([frame.kind.data, frame.kind.compressed])('data frame kind %i round-trips', (kind) => {
  const nonce = frame.nonce(7);
  const encoded = frame.encode({ kind, fingerprint, nonce, ciphertext });
  expect(encoded.length).toBe(1 + 8 + 12 + 20);
  expect(encoded[0]).toBe(kind);
  expect(frame.decode(encoded)).toEqual({ kind, fingerprint, nonce, ciphertext });
});

test('encode rejects a wrong-length fingerprint or nonce', () => {
  const nonce = frame.nonce(0);
  expect(() =>
    frame.encode({ kind: frame.kind.data, fingerprint: fingerprint.slice(1), nonce, ciphertext }),
  ).toThrow(ProtocolError);
  expect(() =>
    frame.encode({ kind: frame.kind.data, fingerprint, nonce: nonce.slice(1), ciphertext }),
  ).toThrow(ProtocolError);
});

test('decode rejects empty input, unknown kinds and short data frames', () => {
  expect(() => frame.decode(new Uint8Array([]))).toThrow(ProtocolError);
  expect(() => frame.decode(new Uint8Array([0x04, 1, 2]))).toThrow(ProtocolError);
  expect(() => frame.decode(new Uint8Array([0x02, ...zeros(30)]))).toThrow(ProtocolError);
});

test('decode reads a frame from an offset view', () => {
  const nonce = frame.nonce(3);
  const inner = frame.encode({ kind: frame.kind.data, fingerprint, nonce, ciphertext });
  const padded = new Uint8Array([0xaa, 0xbb, ...inner]);
  expect(frame.decode(padded.subarray(2))).toEqual({
    kind: frame.kind.data,
    fingerprint,
    nonce,
    ciphertext,
  });
});

test('nonce is a 96-bit big-endian counter', () => {
  expect([...frame.nonce(0)]).toEqual(zeros(12));
  expect([...frame.nonce(1)]).toEqual([...zeros(11), 1]);
  expect([...frame.nonce(2 ** 32)]).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0]);
  expect(frame.counterOf(frame.nonce(2 ** 40 + 5))).toBe(2 ** 40 + 5);
  expect(frame.counterOf(frame.nonce(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
});
