// Sign a built daemon release (ADR 0022). Reads a `dist` directory of `.mjs` files, computes the
// manifest, and writes `manifest.json` + `manifest.json.sig` (raw 64-byte ed25519 signature,
// base64) into it. A thin wrapper over the daemon's signManifest so the sign/verify roundtrip is
// unit-tested in apps/daemon. The signing key is the OFFLINE ed25519 key from ADR 0022; CI never
// holds it. Usage: node scripts/sign-release.mjs <dist-dir> <version> <key.pem>
import { createPrivateKey } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { signManifest } from '../apps/daemon/src/update/sign-manifest.ts';

const fail = (message) => {
  console.error(message);
  process.exitCode = 1;
};

const [distDir, version, keyPath] = process.argv.slice(2);

const run = async () => {
  if (distDir === undefined || version === undefined || keyPath === undefined) {
    fail('usage: node scripts/sign-release.mjs <dist-dir> <version> <key.pem>');
    return;
  }
  const privateKey = createPrivateKey(await readFile(keyPath, 'utf8'));
  const names = (await readdir(distDir)).filter((name) => name.endsWith('.mjs')).toSorted();
  if (names.length === 0) {
    fail(`no .mjs files in ${distDir}`);
    return;
  }
  const files = await Promise.all(
    names.map(async (name) => ({ name, bytes: await readFile(join(distDir, name)) })),
  );
  const { manifest, signature } = signManifest(files, version, privateKey);
  await writeFile(join(distDir, 'manifest.json'), manifest);
  await writeFile(
    join(distDir, 'manifest.json.sig'),
    `${Buffer.from(signature).toString('base64')}\n`,
  );
  console.log(`signed ${names.length} file(s) as ${version}: ${names.join(', ')}`);
};

await run();
