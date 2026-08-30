# 0024: The daemon migrates its SQLite database at boot, versioned by `PRAGMA user_version`, forward-only and idempotent

Status: accepted, 2026-08-30.

## Context

The daemon persists everything in one SQLite file (ADR 0006) and self-updates in place (ADR 0021/0022): the file outlives every code swap. On read, `create-event-log.ts` re-validates every stored row against the protocol guard (ADR 0006, ADR 0009) and throws `stored event N is invalid` on the first row that fails. So the moment a release renames or reshapes a persisted field, every pre-existing row of that shape fails the guard and the daemon bricks on its next read — exactly what renaming `session.created`'s `agent` field to `harness` (PR #50) did to a box paired before it. Schema evolution so far was only `open-database.ts`'s ad-hoc `addMissingColumns`; there was no way to rewrite stored payloads. A real, small mechanism is needed, and it must run unattended on every boot.

## Decision

1. **Ordered migrations run at boot in `openDatabase`, gated by `user_version`.** The daemon holds an ordered list of `{ version, name, up }` migrations (`run-migrations.ts`) and runs them after the schema exists and `addMissingColumns` has run, but before any store reads the database. Each `up` whose version is above the stored `user_version` runs in ascending order; `user_version` advances to the latest **only after the whole set has succeeded**. A crash mid-set therefore leaves the version behind and re-runs the whole set on the next boot, so **every migration must be idempotent** — a no-op on rows it has already migrated (migration 001 guards on `agent IS NOT NULL`).

2. **`PRAGMA user_version`, not a `migrations` table.** The daemon single-writes its one database file and the migration set is a short append-only list; there is nothing to query about applied-at times, so the built-in header integer is the whole of the state we need. A table would be more machinery for no answerable question.

3. **A persisted-shape change requires a migration; the read guard stays strict.** Renaming or removing a stored event field, or adding a new required column, means adding a migration — not relaxing the strict event-log read guard (ADR 0006) to tolerate old rows. The guard stays strict; the data is brought forward to meet it.

4. **Forward-only; no down-migrations.** The daemon never downgrades — self-update refuses a version at or below its own (ADR 0022) — so a reverse path would never run and is out of scope.

5. **This is the sanctioned way persisted state evolves across a self-update (ADR 0021/0022).** Additive, append-only shapes are still preferred (as the wire protocol is), because they need no migration; a migration is for the changes that cannot be additive. Migration 001 (`session.created` `agent` → `harness`) is the first entry.

## Consequences

- A persisted-shape change is a code change plus one appended migration and its test, landed together — the same discipline the wire protocol already follows.
- Version tracking is a single SQLite header integer; there is no audit trail of when each migration ran, which is acceptable because the daemon owns and single-writes the file.
- A broken migration crash-loops the daemon under its supervisor (ADR 0022), exactly like a bad self-update: the failure surfaces loudly rather than corrupting data. This is why migrations must be idempotent and tested — the boot-time runner is only as safe as the `up` functions in the list.
