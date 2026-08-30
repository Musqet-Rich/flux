import type { KeyObject } from 'node:crypto';
import { sign } from 'node:crypto';

import { buildManifest } from './build-manifest.ts';

// The release manifest (ADR 0022): one daemon release as its version and the sha256 of each file
// it ships. The signed message is the literal manifest.json bytes — no canonical-JSON step: the
// signer serialises the object once (build-manifest.ts), signs those exact bytes, and the verifier
// reads and verifies the same bytes (see verify-manifest.ts). sha256 values are lowercase hex.
export interface ReleaseFile {
  name: string;
  sha256: string;
}

export interface ReleaseManifest {
  version: string;
  files: ReleaseFile[];
}

export interface FileToSign {
  name: string;
  bytes: Uint8Array;
}

export interface SignedManifest {
  manifest: Uint8Array;
  signature: Uint8Array;
}

// Build the manifest bytes (build-manifest.ts), then sign them with the offline ed25519 key
// (crypto.sign(null, ...) selects Ed25519 for an ed25519 key). Returns the manifest bytes to write
// as manifest.json and the raw 64-byte detached signature.
export const signManifest = (
  files: FileToSign[],
  version: string,
  privateKey: KeyObject,
): SignedManifest => {
  const bytes = buildManifest(files, version);
  return { manifest: bytes, signature: sign(null, bytes, privateKey) };
};
