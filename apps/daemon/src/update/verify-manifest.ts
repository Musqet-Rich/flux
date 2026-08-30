import { createHash, verify } from 'node:crypto';

import { guards } from '@flux/protocol';

import type { ReleaseFile, ReleaseManifest } from './sign-manifest.ts';
import { trustedKeys } from './trusted-keys.ts';

export interface VerifyInput {
  manifest: Uint8Array;
  signature: Uint8Array;
  files: Map<string, Uint8Array>;
  keys?: string[];
}

// A discriminated result, not a thrown error: the update RPC/event codes (ADR 0022 § 5) are added
// in the update-RPC PR and map onto these reasons. `bad_signature`: no trusted key verifies the
// manifest bytes. `bad_hash`: a listed file's bytes do not match its sha256. `malformed`: the
// manifest does not parse/validate, or the file set does not match the manifest exactly.
export type VerifyResult =
  | { ok: true; version: string }
  | { ok: false; reason: 'bad_signature' | 'bad_hash' | 'malformed' };

const hex64 = /^[0-9a-f]{64}$/u;

const isReleaseFile = (value: unknown): value is ReleaseFile => {
  if (!guards.isRecord(value)) return false;
  const name = value['name'];
  const sha256 = value['sha256'];
  return guards.isString(name) && name.length > 0 && guards.isString(sha256) && hex64.test(sha256);
};

const isReleaseManifest = (value: unknown): value is ReleaseManifest => {
  if (!guards.isRecord(value)) return false;
  const version = value['version'];
  return (
    guards.isString(version) &&
    version.length > 0 &&
    guards.isArrayOf(value['files'], isReleaseFile)
  );
};

const parseManifest = (manifest: Uint8Array): ReleaseManifest | null => {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(manifest));
    return isReleaseManifest(value) ? value : null;
  } catch {
    return null;
  }
};

// Verify the detached signature over the raw manifest bytes under each trusted key until one
// passes, then parse and validate the manifest, then confirm the supplied files are exactly those
// listed and each hashes to its recorded sha256. `keys` defaults to the vendored trusted set;
// tests inject an ephemeral key. Never throws (engineering.md § TypeScript).
export const verifyManifest = (input: VerifyInput): VerifyResult => {
  const keys = input.keys ?? trustedKeys;
  const signed = keys.some((key) => verify(null, input.manifest, key, input.signature));
  if (!signed) return { ok: false, reason: 'bad_signature' };

  const manifest = parseManifest(input.manifest);
  if (manifest === null) return { ok: false, reason: 'malformed' };
  if (manifest.files.length !== input.files.size) return { ok: false, reason: 'malformed' };

  for (const file of manifest.files) {
    const bytes = input.files.get(file.name);
    if (bytes === undefined) return { ok: false, reason: 'malformed' };
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
      return { ok: false, reason: 'bad_hash' };
    }
  }
  return { ok: true, version: manifest.version };
};
