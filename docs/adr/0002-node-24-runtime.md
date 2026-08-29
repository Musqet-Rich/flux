# 0002: Node 24 as the only server runtime

Status: accepted, 2026-08-28.

## Context

Daemon and relay need: process spawning with stdio, PTY (fallback path), WebSocket client and server, SQLite, WebCrypto with X25519, HTTP. Candidates: Node 24, Bun, Deno.

## Decision

Node 24 LTS. Bun and Deno would remove the `ws` dependency and add built-in SQLite, but they are an additional runtime to trust and their compatibility edges cluster around exactly the process-spawning and PTY code the daemon depends on. Node 24 has native `fetch`, `WebSocket` client, `node:sqlite`, WebCrypto X25519, type stripping and `--env-file`. The one gap, a WebSocket server, costs one small, well-audited dependency.

## Consequences

- `ws` is an approved runtime dependency.
- `.ts` files run directly under Node for scripts and tests; `erasableSyntaxOnly` in tsconfig keeps code strippable.
- Revisit if Node gains a WebSocket server or if Bun's process handling proves itself over a year.
