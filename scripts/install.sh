#!/bin/sh
# Flux daemon installer: stand up a daemon on a fresh box from a signed release.
#
#   curl -fsSL https://raw.githubusercontent.com/Musqet-Rich/flux/main/scripts/install.sh | sh
#
# The security guarantee: this script fetches a release's five assets (the three
# daemon .mjs bundles, manifest.json and its detached ed25519 signature), then
# VERIFIES the signature over the exact manifest bytes and every file's SHA-256
# against the manifest BEFORE it places or runs a single downloaded byte. If any
# check fails it aborts and deletes the download; nothing unsigned is ever run.
# This mirrors the daemon's own self-update path (apps/daemon/src/update/*).
#
# What it does, in order:
#   1. Check prerequisites: node (>= 24) and curl.
#   2. Resolve the target version (releases/latest, or $FLUX_VERSION).
#   3. Download the five release assets to a private temp dir.
#   4. Verify the signature and every hash against the vendored trusted keys.
#   5. Only then place the three .mjs into the install dir and run
#      `node <installdir>/index.mjs service install` (ADR 0022 supervision).
#
# Environment overrides:
#   FLUX_INSTALL_DIR   where the .mjs land (default ~/.flux/bin)
#   FLUX_VERSION       install this exact version instead of releases/latest
#   FLUX_RELEASE_REPO  GitHub repo to fetch from (default Musqet-Rich/flux)
#
# Spec: docs/adr/0021 (releases), docs/adr/0022 (signed bundle + supervision),
# docs/releases.md (bundle/manifest/signature format).
set -eu

DEFAULT_REPO='Musqet-Rich/flux'

say() { printf 'flux install: %s\n' "$1"; }
die() { printf 'flux install: %s\n' "$1" >&2; exit 1; }

# --- 1. Prerequisites ------------------------------------------------------
command -v curl >/dev/null 2>&1 || die 'curl is required but was not found on PATH'
command -v node >/dev/null 2>&1 || die 'node (v24+) is required but was not found on PATH'

node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
[ "$node_major" -ge 24 ] 2>/dev/null || die "Node 24+ is required, found $(node --version 2>/dev/null || echo none)"

# --- 2. Resolve repo, version and install dir ------------------------------
repo=${FLUX_RELEASE_REPO:-$DEFAULT_REPO}
install_dir=${FLUX_INSTALL_DIR:-$HOME/.flux/bin}

# releases/latest already excludes drafts and prereleases (discover-latest.ts),
# so an unsigned draft is never resolved here. The tag is validated as strict
# semver before it is ever interpolated into a URL; the signature — not this
# string — is what ultimately gates what runs.
resolve_latest() {
  api="https://api.github.com/repos/$repo/releases/latest"
  body=$(curl -fsSL -H 'Accept: application/vnd.github+json' "$api") ||
    die "could not reach $api (set FLUX_VERSION to install a specific version)"
  # node only PARSES the JSON to read tag_name; it never executes the body.
  printf '%s' "$body" | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)); process.stdin.on("end", () => {
      try { const t = JSON.parse(s).tag_name; if (typeof t === "string") process.stdout.write(t); }
      catch { /* leave empty; the caller fails loudly */ }
    });'
}

if [ "${FLUX_VERSION:-}" != "" ]; then
  tag=$FLUX_VERSION
else
  say "resolving the latest release of $repo"
  tag=$(resolve_latest)
fi
version=${tag#v}
[ "$version" != "" ] || die 'could not resolve a release version'
# Strict semver (major.minor.patch, optional -prerelease/+build); reject anything else.
printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$' ||
  die "resolved version '$version' is not valid semver"

base="https://github.com/$repo/releases/download/v$version"
say "installing flux daemon $version from $repo"

# --- 3. Download to a private temp dir -------------------------------------
work=$(mktemp -d "${TMPDIR:-/tmp}/flux-install.XXXXXX") || die 'could not create a temp directory'
chmod 700 "$work"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT INT TERM HUP

fetch() {
  # $1 asset name, $2 destination path.
  curl -fsSL "$base/$1" -o "$2" || die "download failed: $base/$1"
}

fetch manifest.json "$work/manifest.json"
fetch manifest.json.sig "$work/manifest.json.sig"
for name in index.mjs flux-mcp.mjs flux-pi-extension.mjs; do
  fetch "$name" "$work/$name"
done

# --- 4. VERIFY before anything is placed or executed -----------------------
# The trusted ed25519 release-signing public keys. These MUST be kept byte-for-
# byte identical to apps/daemon/src/update/trusted-keys.ts: one live signer and
# two offline spares (ADR 0022). A manifest signed by ANY one of them is trusted.
cat >"$work/trusted-keys.pem" <<'TRUSTED_KEYS_PEM'
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAgxsI5pG1dFpWMil0SsyHLOsVJVXEXquUcKm8gA4rKGc=
-----END PUBLIC KEY-----
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAWFsNn/5hDuiHpZREmICSZMtS2cHj019/ObP6KLwxGXg=
-----END PUBLIC KEY-----
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAWKiT069wl6UVOQNMrKNT2bhY3SgsQZTZ6hPsRl5WnLo=
-----END PUBLIC KEY-----
TRUSTED_KEYS_PEM

# The verifier is written here (never downloaded) so no unsigned byte is fed to
# node as code. It mirrors apps/daemon/src/update/verify-manifest.ts exactly:
# detached ed25519 over the raw manifest bytes under any trusted key, then the
# manifest shape, then each listed file's SHA-256. It reads its trusted keys
# from argv so the offline unit test can inject an ephemeral key (as
# verify-manifest.test.ts injects `keys`); production always passes the vendored
# set above. It prints a reason and exits non-zero on any failure.
cat >"$work/verify.mjs" <<'VERIFY_MJS'
import { createHash, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [workdir, keysFile] = process.argv.slice(2);
const bundleFiles = ['index.mjs', 'flux-mcp.mjs', 'flux-pi-extension.mjs'];
const hex64 = /^[0-9a-f]{64}$/u;

const fail = (reason) => {
  process.stderr.write(`verify failed: ${reason}\n`);
  process.exit(1);
};

let manifestBytes;
let signature;
let keysText;
try {
  manifestBytes = readFileSync(join(workdir, 'manifest.json'));
  signature = Buffer.from(readFileSync(join(workdir, 'manifest.json.sig'), 'utf8').trim(), 'base64');
  keysText = readFileSync(keysFile, 'utf8');
} catch {
  fail('unreadable_download');
}

const keys = keysText.match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/gu) ?? [];
if (keys.length === 0) fail('no_trusted_keys');

let signed = false;
for (const key of keys) {
  try {
    if (verify(null, manifestBytes, key, signature)) {
      signed = true;
      break;
    }
  } catch {
    /* a malformed key or signature simply does not verify */
  }
}
if (!signed) fail('bad_signature');

let manifest;
try {
  manifest = JSON.parse(manifestBytes.toString('utf8'));
} catch {
  fail('malformed');
}

const isFile = (f) =>
  f !== null &&
  typeof f === 'object' &&
  typeof f.name === 'string' &&
  f.name.length > 0 &&
  typeof f.sha256 === 'string' &&
  hex64.test(f.sha256);
const ok =
  manifest !== null &&
  typeof manifest === 'object' &&
  typeof manifest.version === 'string' &&
  manifest.version.length > 0 &&
  Array.isArray(manifest.files) &&
  manifest.files.every(isFile);
if (!ok) fail('malformed');

const files = new Map();
for (const name of bundleFiles) {
  try {
    files.set(name, readFileSync(join(workdir, name)));
  } catch {
    /* a missing bundle file is caught by the count/lookup below */
  }
}
if (manifest.files.length !== files.size) fail('malformed');
for (const f of manifest.files) {
  const bytes = files.get(f.name);
  if (bytes === undefined) fail('malformed');
  if (createHash('sha256').update(bytes).digest('hex') !== f.sha256) fail('bad_hash');
}
process.stdout.write(`verified ${manifest.version}\n`);
VERIFY_MJS

say 'verifying the signature and file hashes against the trusted keys'
node "$work/verify.mjs" "$work" "$work/trusted-keys.pem" ||
  die 'signature/hash verification FAILED; nothing was installed'

# --- 5. Place the verified bundle and set up supervision -------------------
mkdir -p "$install_dir"
for name in index.mjs flux-mcp.mjs flux-pi-extension.mjs; do
  cp "$work/$name" "$install_dir/$name"
done
chmod 644 "$install_dir"/*.mjs
say "placed the verified daemon $version in $install_dir"

entry="$install_dir/index.mjs"
say 'running `service install` to set up the supervisor (ADR 0022)'
echo '----------------------------------------------------------------------'
# This runs the freshly VERIFIED index.mjs. It writes the host's supervisor
# manifest (systemd/launchd/wrapper) and stages any sudo commands rather than
# escalating; it never runs the daemon here.
node "$entry" service install || say 'service install reported an issue; see its output above'
echo '----------------------------------------------------------------------'

cat <<EOF
flux install: done. The verified daemon $version is in $install_dir.

Next steps:
  1. Set FLUX_RELAY_URL (and any FLUX_* options) in the daemon's environment,
     then follow the 'service install' output above to start it on boot.
  2. Pair a device once the daemon is running:
       node $entry pair
  3. Later, check for a newer signed release without installing it:
       node $entry update --check
EOF
