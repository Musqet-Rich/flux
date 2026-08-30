// Sign a drafted release and publish it (ADR 0021, docs/releases.md § Cut a release). This is the
// ONE command the operator runs after CI drafts a release: it downloads CI's manifest.json, produces
// a detached ed25519 signature over its exact bytes with the OFFLINE private key, uploads
// manifest.json.sig alongside it, and flips the draft to a published release. Signing the literal
// manifest bytes CI produced (not a re-serialisation) is what guarantees the signature matches the
// published files. Usage:
//   node scripts/sign-and-publish.mjs <tag> [--key <path-to-pem>]
// Without --key the private key comes from the macOS Keychain item `flux-release-signing`
// (`security find-generic-password -s flux-release-signing -w`); --key reads a PEM file instead.
import { execFileSync } from 'node:child_process';
import { createPrivateKey, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fail = (message) => {
  console.error(message);
  process.exitCode = 1;
};

const [tag, flag, value] = process.argv.slice(2);

const run = () => {
  if (tag === undefined) {
    fail('usage: node scripts/sign-and-publish.mjs <tag> [--key <path-to-pem>]');
    return;
  }
  const keyPath = flag === '--key' ? value : undefined;
  const dir = mkdtempSync(join(tmpdir(), 'flux-release-'));
  console.log(`1/4 downloading manifest.json for ${tag} …`);
  execFileSync('gh', ['release', 'download', tag, '--pattern', 'manifest.json', '--dir', dir], {
    stdio: 'inherit',
  });
  console.log('2/4 signing the manifest bytes with the offline key …');
  const manifest = readFileSync(join(dir, 'manifest.json'));
  const pem =
    keyPath === undefined
      ? execFileSync('security', ['find-generic-password', '-s', 'flux-release-signing', '-w'], {
          encoding: 'utf8',
        })
      : readFileSync(keyPath, 'utf8');
  const signature = sign(null, manifest, createPrivateKey(pem));
  const sigPath = join(dir, 'manifest.json.sig');
  writeFileSync(sigPath, `${Buffer.from(signature).toString('base64')}\n`);
  console.log(`3/4 uploading manifest.json.sig to ${tag} …`);
  execFileSync('gh', ['release', 'upload', tag, sigPath, '--clobber'], { stdio: 'inherit' });
  console.log(`4/4 publishing ${tag} …`);
  execFileSync('gh', ['release', 'edit', tag, '--draft=false'], { stdio: 'inherit' });
  console.log(`published ${tag}`);
};

try {
  run();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
