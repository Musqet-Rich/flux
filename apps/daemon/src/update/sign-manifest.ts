import type { KeyObject } from 'node:crypto';
import { createHash, sign } from 'node:crypto';

// The release manifest (ADR 0022): one daemon release as its version and the sha256 of each file
// it ships. The signed message is the literal manifest.json bytes — no canonical-JSON step: the
// signer serialises the object once, signs those exact bytes, and the verifier reads and verifies
// the same bytes (see verify-manifest.ts). sha256 values are lowercase hex of each file's bytes.
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

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

// Serialise the manifest to the exact bytes that get signed. Pretty-printed with a trailing
// newline so the committed manifest.json is readable; the format is internal, since the signature
// covers whatever bytes are produced here and the verifier checks the file bytes as they are.
const serialise = (manifest: ReleaseManifest): Uint8Array =>
  new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);

// Compute each file's sha256, build the manifest, serialise it, and sign those bytes with the
// offline ed25519 key (crypto.sign(null, ...) selects Ed25519 for an ed25519 key). Returns the
// manifest bytes to write as manifest.json and the raw 64-byte detached signature.
export const signManifest = (
  files: FileToSign[],
  version: string,
  privateKey: KeyObject,
): SignedManifest => {
  const manifest: ReleaseManifest = {
    version,
    files: files.map((file) => ({ name: file.name, sha256: sha256Hex(file.bytes) })),
  };
  const bytes = serialise(manifest);
  return { manifest: bytes, signature: sign(null, bytes, privateKey) };
};
