# Flux releases: cutting, signing and publishing

Status: v2, 2026-08-30. Spec: ADR 0021 (releases and versioning), ADR 0022 (the signed bundle).
A release is one git tag `vX.Y.Z`. CI builds and drafts; the operator signs offline and publishes;
Coolify redeploys the relay image. This page is the runbook plus the manifest format. Once a release
is published, a daemon updates itself from the PWA: Settings shows **Update daemon to X.Y.Z** when the
box is behind, and the box fetches that release, verifies it, swaps its files and restarts (ADR 0022,
architecture.md § Self-update).

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

CI writes the manifest but never holds the key: the release workflow runs `scripts/sign-release.mjs`
in its `--manifest-only` mode, which writes `manifest.json` and no signature. The operator produces
the signature offline over those exact bytes with `scripts/sign-and-publish.mjs`. Both the CI manifest
and the operator's signature go through one serialisation (`apps/daemon/src/update/build-manifest.ts`),
so they always cover byte-identical manifest bytes.

## Runbook

The operator will forget between releases. Follow these steps in order.

### Prerequisites (once)

1. **Signing key in the macOS Keychain.** The offline ed25519 private key (ADR 0022 § key handling)
   is stored as a generic password named `flux-release-signing`. Load a PEM you already hold with:

   ```sh
   security add-generic-password -s flux-release-signing -a "$USER" -w "$(cat release-key.pem)"
   ```

   `scripts/sign-and-publish.mjs` reads it back with
   `security find-generic-password -s flux-release-signing -w`. Keep the PEM offline (a hardware
   token or an encrypted volume); the Keychain copy is the working convenience. To sign from a
   one-off PEM path instead of the Keychain, pass `--key <path-to-pem>`.

2. **`gh` authenticated.** `gh auth login` as an account with write access to `Musqet-Rich/flux`
   releases. The scripts and the workflow both drive the `gh` CLI.
3. **Coolify pointed at the image.** Coolify pulls `ghcr.io/musqet-rich/flux-relay` and is set to
   redeploy on a new tag (or the operator clicks redeploy). The relay holds no state (ADR 0003), so
   a redeploy is safe at any time.

### Cut a release

1. **Bump the version.** Set the root `package.json` `version` to `X.Y.Z` and commit. The build
   stamps this into the daemon, and the workflow refuses to run if it disagrees with the tag.
2. **Tag and push.**

   ```sh
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

3. **Wait for the `release` workflow to go green.** On the `vX.Y.Z` tag it builds every package,
   drafts a GitHub Release carrying the three daemon `.mjs` files and `manifest.json`, and pushes
   `ghcr.io/musqet-rich/flux-relay:X.Y.Z` and `:latest`. The release is a **draft** — it has no
   signature yet, so it is not public.
4. **Sign and publish.** One command downloads CI's manifest, signs it offline, uploads the
   signature and flips the draft to published:

   ```sh
   node scripts/sign-and-publish.mjs vX.Y.Z
   ```

   Add `--key <path-to-pem>` to sign from a PEM file instead of the Keychain. The command fails
   loudly (non-zero) if the tag, its draft or the key is missing, and prints each step.

5. **Redeploy the relay.** In Coolify, redeploy the relay service (or let it auto-pull) so the relay
   and the PWA baked into the image both move to `X.Y.Z`.

### Verify

The published release has **five** assets: the three daemon files (`index.mjs`, `flux-mcp.mjs`,
`flux-pi-extension.mjs`), `manifest.json`, and `manifest.json.sig`. The daemon's update path (a later
PR) fetches these, checks each file's hash against the manifest and the signature against the trusted
key set (`apps/daemon/src/update/verify-manifest.ts`), and runs the bundle only when all of that
passes.

## Supervision

Self-update ends in a clean `process.exit(0)`; something on the box must restart the daemon into
the new code, and keep it always-on and start-on-boot besides (ADR 0022 § 6). Run `flux service
install` once per box; it detects the host and writes the right supervisor manifest, baking in the
running node binary, the installed `index.mjs`, the invoking user and the daemon's `FLUX_*`/`PATH`
environment. `flux service status` reports whether the manifest is installed and loaded, and `flux
service uninstall` reverses it.

- **Linux (systemd).** As root it writes a hardened `/etc/systemd/system/flux-daemon.service`
  (modelled on `deploy/flux-daemon.service`) and runs `systemctl enable --now flux-daemon`. Not
  root, it stages the unit under `$FLUX_DATA_DIR` and prints the exact `sudo cp` / `daemon-reload` /
  `enable --now` commands — nothing is escalated for you.
- **macOS (launchd).** It writes a per-user LaunchAgent at
  `~/Library/LaunchAgents/com.flux.daemon.plist` (`RunAtLoad` + `KeepAlive`) and `launchctl load`s
  it — no sudo. It runs while you are logged in, so the agents inherit your keychain, PATH and
  `claude`/`gh` logins. A **headless Mac** that must run before any login needs a root
  **LaunchDaemon** under `/Library/LaunchDaemons` instead; that runs at boot but loses your GUI
  login session and its keychain, so use it only when nobody logs in on the box.
- **No init system (a typical devcontainer).** It writes a restart-loop wrapper
  (`$FLUX_DATA_DIR/flux-daemon-run.sh`) and prints how to run it — under `nohup` or the
  container/compose restart policy. Without it, a bare daemon can still update but stays down after
  the update's exit until something starts it again.

## Signing outside the release flow

To sign a locally built `dist` directory directly — the same manifest and signature the flow
produces, in one step, with the private key on disk:

```sh
pnpm --filter @flux/daemon run build
node scripts/sign-release.mjs apps/daemon/dist X.Y.Z /path/to/release-key.pem
```

This writes `manifest.json` and `manifest.json.sig` into the directory. `scripts/sign-release.mjs`
is a thin wrapper over the daemon's `signManifest`, so the sign/verify roundtrip is covered by
`apps/daemon/src/update/verify-manifest.test.ts`, and its `--manifest-only` mode (the mode CI uses)
by `apps/daemon/src/update/manifest-only.test.ts`.
