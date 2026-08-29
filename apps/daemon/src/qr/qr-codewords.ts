import { DaemonError } from '../daemon-error.ts';
import { qrTables } from './qr-tables.ts';
import { reedSolomon } from './reed-solomon.ts';

// The final codeword sequence for byte-mode text at a given version (ISO/IEC 18004 § 7.4 to
// § 7.6): mode and count indicators, the UTF-8 bytes, terminator, pad codewords, then the data
// blocks and their EC blocks interleaved codeword by codeword.

const padCodewords = [0xec, 0x11];

const bitStream = (bytes: Uint8Array, version: number): Uint8Array => {
  const total = qrTables.dataCodewords(version);
  const countBits = qrTables.countBits(version);
  const out = new Uint8Array(total);
  let bitIndex = 0;
  const push = (value: number, width: number): void => {
    for (let i = width - 1; i >= 0; i -= 1) {
      const byte = bitIndex >> 3;
      if (((value >> i) & 1) === 1) out[byte] = (out[byte] ?? 0) | (0x80 >> (bitIndex & 7));
      bitIndex += 1;
    }
  };
  push(0b0100, 4);
  push(bytes.length, countBits);
  for (const byte of bytes) push(byte, 8);
  // Terminator (up to four zero bits) then pad to a byte boundary: zero-filled already, so
  // only the byte index moves. The remaining codewords alternate 0xEC and 0x11.
  bitIndex = Math.min(bitIndex + 4, total * 8);
  for (let byte = Math.ceil(bitIndex / 8), i = 0; byte < total; byte += 1, i += 1) {
    out[byte] = padCodewords[i % 2] ?? 0;
  }
  return out;
};

interface Block {
  data: Uint8Array;
  ec: Uint8Array;
}

const splitBlocks = (stream: Uint8Array, version: number): Block[] => {
  const { ecPerBlock, groups } = qrTables.ecBlocks(version);
  const blocks: Block[] = [];
  let offset = 0;
  for (const group of groups) {
    for (let i = 0; i < group.count; i += 1) {
      const data = stream.subarray(offset, offset + group.dataCodewords);
      blocks.push({ data, ec: reedSolomon.remainder(data, ecPerBlock) });
      offset += group.dataCodewords;
    }
  }
  return blocks;
};

const interleave = (blocks: Block[], version: number): Uint8Array => {
  const out = new Uint8Array(qrTables.totalCodewords(version));
  let index = 0;
  const longest = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < longest; i += 1) {
    for (const block of blocks) {
      const byte = block.data[i];
      if (byte !== undefined) out[index++] = byte;
    }
  }
  const ecLength = blocks[0]?.ec.length ?? 0;
  for (let i = 0; i < ecLength; i += 1) {
    for (const block of blocks) out[index++] = block.ec[i] ?? 0;
  }
  return out;
};

export const qrCodewords = (bytes: Uint8Array, version: number): Uint8Array => {
  if (bytes.length > qrTables.byteCapacity(version)) {
    throw new DaemonError('internal', `${bytes.length} bytes do not fit QR version ${version}`);
  }
  return interleave(splitBlocks(bitStream(bytes, version), version), version);
};
