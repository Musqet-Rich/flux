// Prepare a built daemon release (ADR 0021, 0022). Reads a `dist` directory of `.mjs` files and
// writes `manifest.json` describing them. Two modes over the SAME manifest serialisation, so CI's
// manifest and the operator's later signature cover byte-identical manifest bytes:
//   node scripts/sign-release.mjs <dist-dir> <version> <key.pem>          full: manifest + signature
//   node scripts/sign-release.mjs <dist-dir> <version> --manifest-only    manifest only, no key
// Full mode also writes `manifest.json.sig` (raw 64-byte ed25519 signature, base64). It is a thin
// wrapper over the daemon's signManifest/buildManifest so the sign/verify roundtrip stays unit-
// tested in apps/daemon. The signing key is the OFFLINE ed25519 key (ADR 0022); CI, which runs the
// --manifest-only path, never holds it — the operator signs the drafted release with sign-and-publish.mjs.
import { createPrivateKey } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { buildManifest } from '../apps/daemon/src/update/build-manifest.ts';
import { signManifest } from '../apps/daemon/src/update/sign-manifest.ts';

const fail = (message) => {
  console.error(message);
  process.exitCode = 1;
};

const [distDir, version, keyArg] = process.argv.slice(2);

const run = async () => {
  if (distDir === undefined || version === undefined || keyArg === undefined) {
    fail('usage: node scripts/sign-release.mjs <dist-dir> <version> <key.pem | --manifest-only>');
    return;
  }
  const names = (await readdir(distDir)).filter((name) => name.endsWith('.mjs')).toSorted();
  if (names.length === 0) {
    fail(`no .mjs files in ${distDir}`);
    return;
  }
  const files = await Promise.all(
    names.map(async (name) => ({ name, bytes: await readFile(join(distDir, name)) })),
  );
  if (keyArg === '--manifest-only') {
    await writeFile(join(distDir, 'manifest.json'), buildManifest(files, version));
    console.log(`wrote manifest for ${names.length} file(s) as ${version}: ${names.join(', ')}`);
    return;
  }
  const privateKey = createPrivateKey(await readFile(keyArg, 'utf8'));
  const { manifest, signature } = signManifest(files, version, privateKey);
  await writeFile(join(distDir, 'manifest.json'), manifest);
  await writeFile(
    join(distDir, 'manifest.json.sig'),
    `${Buffer.from(signature).toString('base64')}\n`,
  );
  console.log(`signed ${names.length} file(s) as ${version}: ${names.join(', ')}`);
};

await run();
