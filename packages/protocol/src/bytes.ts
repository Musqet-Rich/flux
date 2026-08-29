// Small byte helpers shared by framing and crypto. Platform-only: TextEncoder/Decoder exist in
// browsers and Node 24 alike, so nothing here depends on Buffer.

// WebCrypto takes `BufferSource`, which excludes views over a SharedArrayBuffer; every byte
// value in this package is pinned to a plain ArrayBuffer so it can be handed straight to it.
export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

const concat = (...parts: Bytes[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

// Constant-time on equal lengths so a comparison of proofs or tokens leaks nothing by timing.
const equals = (a: Bytes, b: Bytes): boolean => {
  if (a.length !== b.length) return false;
  const va = new DataView(a.buffer, a.byteOffset, a.byteLength);
  const vb = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= va.getUint8(i) ^ vb.getUint8(i);
  return diff === 0;
};

const fromUtf8 = (text: string): Bytes => encoder.encode(text);

// Throws TypeError on malformed UTF-8 (fatal decoder); callers at the wire boundary wrap it.
const toUtf8 = (data: Bytes): string => decoder.decode(data);

const random = (length: number): Bytes => crypto.getRandomValues(new Uint8Array(length));

export const bytes: {
  concat: typeof concat;
  equals: typeof equals;
  fromUtf8: typeof fromUtf8;
  toUtf8: typeof toUtf8;
  random: typeof random;
} = { concat, equals, fromUtf8, toUtf8, random };
