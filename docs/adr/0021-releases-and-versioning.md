# 0021: Single-version releases; relay and PWA ship on tag, the daemon updates itself, older daemons stay supported

Status: accepted, 2026-08-30.

## Context

The three deployables must stay compatible, but they are not deployed together. The relay and the PWA live on a VPS the project operator controls (Coolify); the daemon runs on each user's own box, devcontainer or VPS, under that user's control. So a release cannot assume every daemon updates at the same time, or ever. Until now every part is `0.0.0` and every machine builds from a source checkout (README § Quickstart); there is no version on the wire, no release artifact, and no way for a user to update a daemon short of `git pull && pnpm build`.

Two things follow. The wire needs a version so a current PWA can tell what an old daemon can do. And the daemon needs an update path that a non-technical operator can trigger from the phone.

## Decision

1. **One version for all four packages, cut as a git tag.** The root `package.json` `version` is the single source of truth; the build stamps it into the relay, the PWA and the daemon (a generated `version.ts`, not hand-edited). `protocol` shares it but keeps its own on-wire `protocolVersion` (§ 8), which is orthogonal: the app version moves every release, the protocol version only on a breaking wire change. A push of tag `vX.Y.Z` is the release; nothing releases off a branch.

2. **Release CI builds, signs and publishes.** On a `v*` tag the workflow builds every package, produces the signed daemon bundle (ADR 0022) and a relay container image (relay + built PWA, `Dockerfile.relay`), and creates a GitHub Release carrying the daemon manifest, its signature and its files. GitHub Releases is the distribution point: the repo is public, the daemon fetches over HTTPS, and integrity rests on the signature, not the transport.

3. **Relay and PWA ship on the tag; the operator redeploys.** The relay image is versioned by the tag; Coolify redeploys it (auto on the tag, or a click). The PWA is baked into that image, so updating the relay updates the PWA in one step. Neither holds state (ADR 0003), so a redeploy is safe at any time. This is the project operator's action, not the user's.

4. **The app version rides in the `hello` RPC result, not the handshake hello.** The daemon returns `version: string` (semver) from `hello` (§ 7). It is deliberately _not_ added to the handshake hellos: those bytes are bound into key derivation (ADR 0019), and changing them would fork the keys and force a protocol bump. Placing the version after the channel is up keeps this additive — `protocolVersion` stays 2. The device already sends a `client` string; that is enough for the daemon, which never needs to adapt down to an old PWA (the PWA is always the current release, served by the relay).

5. **The current PWA supports every daemon from 1.0 forward.** The PWA is the newest part by construction. It compares its own build version to the daemon's `hello.version` and **feature-detects, never assumes**: an older daemon that lacks attachments, subagents or reply simply does not advertise them (the fields are optional and unknown events are already tolerated, § 8), and the PWA hides those affordances rather than breaking. The compat floor is **1.0**: this mechanism is what 1.0 establishes, so there is nothing older to carry. A daemon below the floor gets a blocking "update required" screen instead of a degraded UI. Dropping support for a still-live app version is itself a breaking change and needs its own ADR.

6. **The user triggers a daemon update from the PWA.** When `hello.version` is behind the PWA's own version, the app offers "Update daemon". Accepting sends the `daemon.update` RPC with the PWA's version as the target; the daemon fetches that release, verifies it and restarts into it (ADR 0022). The PWA shows progress from the daemon's events and reconnects when the new version answers `hello`. The daemon is never updated from the wire without the operator asking.

## Consequences

- A release is one tag. The relay/PWA half is the operator redeploying an image; the daemon half is each user updating when they choose, so daemons lag by design and the PWA must keep working across the spread.
- Backward compatibility is a standing obligation on the PWA and the protocol, enforced by keeping additions optional and version-gated. `protocol.md` § 8 already says additive changes do not bump the protocol version; the app version is how the PWA learns which additions a given daemon has.
- The wire change is additive: one optional field on the `hello` result, plus the update RPC and events of ADR 0022. No protocol bump.
- The version stamp must come from the build, not a checked-in constant that drifts; `git describe`/the tag feeds it so a dev build is unambiguously a pre-release.
- A user who never updates keeps a working daemon until the compat floor rises past it; then, and only then, the PWA tells them to update.
