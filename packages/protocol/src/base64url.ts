import type { Bytes } from './bytes.ts';
import { ProtocolError } from './protocol-error.ts';

// RFC 4648 §5, unpadded. Hand-written because `Bytes.fromBase64` is not in ES2024 and
// `Buffer` is not in the browser; forty lines beat a dependency (engineering.md § Dependencies).

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const lookup = new Map(Array.from(alphabet, (c, i) => [c, i]));

const encode = (data: Bytes): string => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let out = '';
  for (let i = 0; i < data.length; i += 3) {
    const remaining = data.length - i;
    const a = view.getUint8(i);
    const b = remaining > 1 ? view.getUint8(i + 1) : 0;
    const c = remaining > 2 ? view.getUint8(i + 2) : 0;
    const triple = (a << 16) | (b << 8) | c;
    const chars = Math.min(remaining, 3) + 1;
    for (let k = 0; k < chars; k++) {
      out += alphabet.charAt((triple >> (18 - 6 * k)) & 63);
    }
  }
  return out;
};

const decode = (text: string): Bytes => {
  // A valid unpadded length is never ≡ 1 mod 4: that would encode six leftover bits.
  if (text.length % 4 === 1) throw new ProtocolError('bad_base64', 'bad base64url length');
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const value = lookup.get(text.charAt(i));
    if (value === undefined) {
      throw new ProtocolError('bad_base64', `bad base64url char at ${i}`);
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (buffer >> bits) & 255;
    }
  }
  return out;
};

export const base64url: { encode: typeof encode; decode: typeof decode } = { encode, decode };
