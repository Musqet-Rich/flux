# Flux releases: signing daemon bundles

Status: v1, 2026-08-30. Spec: ADR 0022. This page covers the manifest format and the local signing
command only. The daemon self-update RPC, the events it emits, and the release CI are later PRs.

## The bundle

A daemon release is not an archive. It is the raw `.mjs` files `tsdown` emits into `apps/daemon/dist`
(`index.mjs`, `flux-mcp.mjs`, `flux-pi-extension.mjs`, ~200 KB total), a `manifest.json` describing
them, and a detached signature over the manifest bytes. Swapping a release is swapping those files;
its integrity is the signature plus the per-file hashes.

## The manifest

`manifest.json` describes one release: its version and the SHA-256 of each file it ships.

```json
{
  "version": "1.2.3",
  "files": [
    { "name": "index.mjs", "sha256": "<hex>" },
    { "name": "flux-mcp.mjs", "sha256": "<hex>" },
    { "name": "flux-pi-extension.mjs", "sha256": "<hex>" }
  ]
}
```

Each `sha256` is the lowercase hex SHA-256 of that file's bytes.

## What is signed

The signature is a **detached ed25519 signature over the exact bytes of the `manifest.json` file** —
there is no canonical-JSON step. The signer serialises the manifest once, writes those bytes, and
signs them; the verifier reads those same bytes and verifies them. The signature artifact is
`manifest.json.sig`: the raw 64-byte signature, base64-encoded.

Because the signature covers the version and every file hash, a daemon runs only bytes an offline key
signed: a tampered file fails its hash, and a tampered manifest fails the signature. The daemon trusts
a fixed **set** of three ed25519 public keys (`apps/daemon/src/update/trusted-keys.ts`) and accepts a
manifest signed by any one of them — one live signer, two offline spares (ADR 0022).

## Signing a release

Build the daemon, then sign the `dist` directory with the offline private key:

```sh
pnpm --filter @flux/daemon run build
node scripts/sign-release.mjs apps/daemon/dist 1.2.3 /path/to/release-key.pem
```

This writes `manifest.json` and `manifest.json.sig` into the directory. The private key is the offline
ed25519 key from ADR 0022; it is held by the release signer and **never placed in CI** — CI uploads
the already-signed artifact. `scripts/sign-release.mjs` is a thin wrapper over the daemon's
`signManifest`, so the sign/verify roundtrip is covered by `apps/daemon/src/update/verify-manifest.test.ts`.
