import { generateKeyPairSync, sign } from 'node:crypto';
import { expect, test } from 'vitest';

import { signManifest } from './sign-manifest.ts';
import { verifyManifest } from './verify-manifest.ts';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pem = publicKey.export({ type: 'spki', format: 'pem' });

const inputs = [
  { name: 'index.mjs', bytes: enc('one') },
  { name: 'flux-mcp.mjs', bytes: enc('two') },
  { name: 'flux-pi-extension.mjs', bytes: enc('three') },
];
const filesOf = (): Map<string, Uint8Array> => new Map(inputs.map((f) => [f.name, f.bytes]));
const signed = signManifest(inputs, '1.2.3', privateKey);

test('a manifest signed by a key in the set verifies and returns its version', () => {
  const result = verifyManifest({
    manifest: signed.manifest,
    signature: signed.signature,
    files: filesOf(),
    keys: [pem],
  });
  expect(result).toEqual({ ok: true, version: '1.2.3' });
});

test('a file whose bytes do not match the signed hash is bad_hash', () => {
  const files = filesOf();
  files.set('flux-mcp.mjs', enc('tampered'));
  const result = verifyManifest({
    manifest: signed.manifest,
    signature: signed.signature,
    files,
    keys: [pem],
  });
  expect(result).toEqual({ ok: false, reason: 'bad_hash' });
});

test('a signature with a flipped byte is bad_signature', () => {
  const badSig = Uint8Array.from(signed.signature);
  const view = new DataView(badSig.buffer);
  view.setUint8(0, view.getUint8(0) ^ 0x01);
  const result = verifyManifest({
    manifest: signed.manifest,
    signature: badSig,
    files: filesOf(),
    keys: [pem],
  });
  expect(result).toEqual({ ok: false, reason: 'bad_signature' });
});

test('a manifest signed by a key outside the trusted set is bad_signature', () => {
  const other = generateKeyPairSync('ed25519');
  const elsewhere = signManifest(inputs, '1.2.3', other.privateKey);
  const result = verifyManifest({
    manifest: elsewhere.manifest,
    signature: elsewhere.signature,
    files: filesOf(),
    keys: [pem],
  });
  expect(result).toEqual({ ok: false, reason: 'bad_signature' });
});

test('a validly signed but structurally invalid manifest is malformed', () => {
  const bytes = enc('{"version":1,"files":[]}');
  const result = verifyManifest({
    manifest: bytes,
    signature: sign(null, bytes, privateKey),
    files: new Map(),
    keys: [pem],
  });
  expect(result).toEqual({ ok: false, reason: 'malformed' });
});

test('non-JSON manifest bytes are malformed', () => {
  const bytes = enc('not json {');
  const result = verifyManifest({
    manifest: bytes,
    signature: sign(null, bytes, privateKey),
    files: new Map(),
    keys: [pem],
  });
  expect(result).toEqual({ ok: false, reason: 'malformed' });
});

test('an extra file not listed in the manifest is malformed', () => {
  const files = filesOf();
  files.set('extra.mjs', enc('surplus'));
  const result = verifyManifest({
    manifest: signed.manifest,
    signature: signed.signature,
    files,
    keys: [pem],
  });
  expect(result).toEqual({ ok: false, reason: 'malformed' });
});

test('a listed file missing from the set is malformed', () => {
  const files = filesOf();
  files.delete('index.mjs');
  const result = verifyManifest({
    manifest: signed.manifest,
    signature: signed.signature,
    files,
    keys: [pem],
  });
  expect(result).toEqual({ ok: false, reason: 'malformed' });
});
