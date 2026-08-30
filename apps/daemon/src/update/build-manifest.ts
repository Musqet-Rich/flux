import { createHash } from 'node:crypto';

import type { FileToSign, ReleaseManifest } from './sign-manifest.ts';

// Compute each file's sha256 and serialise the manifest to the exact bytes that get signed and
// written as manifest.json. This is the one place the manifest bytes are produced: the signer
// (sign-manifest.ts) signs what this returns, and CI writes what this returns with no signature
// (scripts/sign-release.mjs --manifest-only). The offline signer later signs those identical bytes,
// so both cover byte-for-byte the same manifest. sha256 values are lowercase hex of each file's bytes.
const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

// Pretty-printed with a trailing newline so the committed manifest.json is readable; the format is
// internal, since the signature covers whatever bytes are produced here and the verifier checks the
// file bytes as they are (verify-manifest.ts).
const serialise = (manifest: ReleaseManifest): Uint8Array =>
  new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);

export const buildManifest = (files: FileToSign[], version: string): Uint8Array => {
  const manifest: ReleaseManifest = {
    version,
    files: files.map((file) => ({ name: file.name, sha256: sha256Hex(file.bytes) })),
  };
  return serialise(manifest);
};
