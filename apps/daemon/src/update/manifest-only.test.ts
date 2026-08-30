import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { verifyManifest } from './verify-manifest.ts';

// scripts/sign-release.mjs, four directories up from apps/daemon/src/update/. Running the real
// script proves the two halves of a release fit: CI writes manifest.json with --manifest-only (no
// key), and the operator later detached-signs those exact bytes offline. This drives both paths
// with an ephemeral key and asserts verifyManifest accepts the pair.
const script = fileURLToPath(new URL('../../../../scripts/sign-release.mjs', import.meta.url));

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

const bundle = [
  { name: 'index.mjs', body: 'entry' },
  { name: 'flux-mcp.mjs', body: 'mcp' },
  { name: 'flux-pi-extension.mjs', body: 'pi' },
];

test("CI's --manifest-only manifest verifies under the operator's detached signature", () => {
  const dir = mkdtempSync(join(tmpdir(), 'flux-manifest-only-'));
  bundle.forEach((file) => {
    writeFileSync(join(dir, file.name), file.body);
  });

  execFileSync(process.execPath, [script, dir, '4.5.6', '--manifest-only']);
  const manifest = readFileSync(join(dir, 'manifest.json'));

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const signature = sign(null, manifest, privateKey);

  const result = verifyManifest({
    manifest,
    signature,
    files: new Map(bundle.map((file) => [file.name, enc(file.body)])),
    keys: [pem],
  });

  expect(result).toEqual({ ok: true, version: '4.5.6' });
});
