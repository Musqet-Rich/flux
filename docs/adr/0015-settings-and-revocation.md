# 0015: Settings on the box, agent config as raw files, revocation as a notice

Status: accepted, 2026-08-29. Implements prd.md P2 "edit the box-side Flux config and the agent's config" and "pair a second device, revoke a device".

## Context

The PWA needs a settings screen. Three questions: which of the daemon's configuration may change while it runs and where it lives; how the agent's own config is edited; and how a revoked device finds out, given that the box never answers a stranger's handshake (protocol.md § 3) and the PWA would otherwise sit in "connecting" forever.

## Decision

- **Runtime settings** (`FluxSettings`: repositories directory, default agent, which events push) live in a `settings` table in the daemon's SQLite (ADR 0006), one JSON row, read on every use so a change applies to the next call and the next notification without a restart. The environment gives the starting values; a stored value wins once set. The repositories directory is resolved (no trailing slash, no `..`) and must exist as a directory, or the patch is `bad_params` and nothing is written. Everything else the environment sets (relay URL, data dir, daemon name, push subject, agent binary) cannot safely change under a running process and is reported read-only as `EnvSettings`. No config file: the box already has one database and it is backed up with it.
- **Agent config** is the flux user's `~/.claude/CLAUDE.md` and `~/.claude/settings.json`, read and written verbatim as strings (`AgentConfig`). Flux does not model Claude Code's settings schema, which changes with every release; it only refuses `settings.json` that is not a JSON object (`null`, `[]`, a string or an empty file parse or fail in ways that stop Claude Code from starting). Each file is written to a sibling temp file and renamed into place, keeping the existing mode, so a crash cannot leave a half-written config; a symlinked file is replaced by a regular file rather than written through, which is the price of the rename. In a `settings.set` carrying both halves the files are written first, so a failed write leaves the database untouched. `FLUX_CLAUDE_DIR` overrides the directory (tests, unusual homes).
- **Revocation** is a new ephemeral, `device.revoked`, sent on the revoked device's channel before the box forgets it (protocol.md § 6). Additive, so no version bump. `devices.remove` deletes the key, the device's push subscriptions and its live channel, in that order; the channel loses its trust the moment the revocation starts: a request already dispatched to its handler completes (its trust check had passed) and its answer goes out, while frames not yet dispatched are dropped. `flux devices rm` runs in another process, so it sends `devices.rm` to the running daemon over the control socket (like `flux pair`) and only falls back to the database, saying so, when no daemon answers; the next daemon start honours the database either way. A device may remove itself; the RPC result goes out before the notice. On the notice, or on a `not_paired` answer after pairing, the PWA forgets its keys and returns to the pair screen. A revoked device that reconnects while a pairing window is open is treated as a stranger (it may only `pair.request`); with no window open its handshake is ignored, as for any stranger.
- The PWA edits the agent files in plain text areas, not CodeMirror: two small files, no diffing, and a `<textarea>` works in a happy-dom test. Revisit if operators want syntax help.

## Consequences

- One more table, one more ephemeral type, four RPC methods; `docs/protocol.md` § 6 and § 7 updated.
- `flux devices ls` shows the last time each device said hello, from the same column the PWA reads.
- A pre-release database gets the `devices.last_seen_at` column added on open; the "no migrations until a release" rule (`open-database.ts`) gains that one exception.
