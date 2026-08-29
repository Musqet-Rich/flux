# 0006: Event log in node:sqlite, gapless per-session seq

Status: accepted, 2026-08-28.

## Context

The daemon needs durable, append-only, per-session event storage with cheap `seq > since` queries and atomic appends. Options: JSONL files (like Claude Code's transcripts), SQLite, an embedded KV.

## Decision

`node:sqlite`, one database file, table `events(session TEXT, seq INTEGER, ts TEXT, type TEXT, payload TEXT, PRIMARY KEY(session, seq))` plus `sessions` and `devices` tables. `seq` is assigned inside a transaction as `max(seq)+1` per session so it is gapless. Streaming deltas are not stored.

JSONL rejected: no indexed range reads without loading the file, and concurrency is manual. Zero dependencies either way; SQLite wins on query shape.

## Consequences

- Sync protocol relies on gapless `seq`; the client detects any gap and re-syncs.
- Claude's own transcript files remain a recovery source if the database is lost.
- WAL mode on, single writer (the daemon process).
