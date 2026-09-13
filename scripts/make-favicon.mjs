// The app icon at /favicon.ico. index.html links /icon-192.png, and a browser rendering the
// page takes that link and never asks for /favicon.ico; what fetches the path blind, a bookmark
// importer or a link preview, would get the shell from the relay's single-page fallback. This
// packs the icon at 16, 32 and 48 px into one ICO, each entry a PNG (every current browser reads
// PNG entries; the BMP form only serves browsers older than the PWA supports), resized by
// macOS's sips and cut to IHDR, IDAT and IEND like the PNGs beside it. Run when the artwork
// changes:
//   node scripts/make-favicon.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sizes = [16, 32, 48];
const publicDir = join(import.meta.dirname, '..', 'apps', 'pwa', 'public');
const source = join(publicDir, 'icon-512.png');
const target = join(publicDir, 'favicon.ico');
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const kept = new Set(['IHDR', 'IDAT', 'IEND']);
// The colour type byte of IHDR: 6 is RGBA, the one form whose pixels need no other chunk and
// whose ICO entry is honestly 32 bits a pixel with no palette.
const colourTypeAt = 25;

// sips writes sRGB and eXIf chunks the image does without; only the pixels ship. A chunk is a
// 4-byte length, a 4-byte type, the data and a 4-byte CRC.
/** @param {Buffer} png */
const stripChunks = (png) => {
  if (!png.subarray(0, signature.length).equals(signature) || png[colourTypeAt] !== 6) {
    throw new Error('sips did not write an RGBA PNG');
  }
  const chunks = [];
  let at = signature.length;
  while (at < png.length) {
    const end = at + 12 + png.readUInt32BE(at);
    if (kept.has(png.toString('latin1', at + 4, at + 8))) chunks.push(png.subarray(at, end));
    at = end;
  }
  return Buffer.concat([signature, ...chunks]);
};

// ICONDIR (6 bytes: reserved, type 1 for icon, count), one ICONDIRENTRY (16 bytes: width,
// height, palette size, reserved, colour planes, bits per pixel, byte length, byte offset) per
// image, then the images back to back. A 256 px side would have to be written as 0, which
// writeUInt8 refuses; none here reaches it.
/** @param {{ size: number; bytes: Buffer }[]} images */
const packIco = (images) => {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, bytes }, index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(size, entry);
    header.writeUInt8(size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(bytes.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += bytes.length;
  });
  return Buffer.concat([header, ...images.map(({ bytes }) => bytes)]);
};

/**
 * @param {string} dir
 * @param {number} size
 */
const resize = (dir, size) => {
  const out = join(dir, `${size}.png`);
  execFileSync('sips', ['-z', `${size}`, `${size}`, '-s', 'format', 'png', source, '--out', out]);
  return { size, bytes: stripChunks(readFileSync(out)) };
};

const make = () => {
  const dir = mkdtempSync(join(tmpdir(), 'favicon-'));
  try {
    writeFileSync(target, packIco(sizes.map((size) => resize(dir, size))));
    console.log(`wrote ${target}: ${sizes.join(', ')} px`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

if (process.platform === 'darwin') {
  make();
} else {
  console.error('make-favicon needs macOS: the resize is sips');
  process.exitCode = 1;
}
