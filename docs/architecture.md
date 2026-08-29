# Flux: architecture

Status: draft v1, 2026-08-28.

## Overview

```
┌──────────────── box (VPS / container) ────────────────┐
│                                                        │
│  claude ──stdin/stdout──┐                              │
│  pi     ──stdin/stdout──┤   daemon                     │
│  ~/.claude/…/*.jsonl ───┤   ├─ adapters (read + write) │
│  git worktrees ─────────┤   ├─ event log (sqlite)      │
│  flux MCP tools ────────┘   ├─ git / fs service        │
│                             └─ one outbound WSS ───────┼──┐
└────────────────────────────────────────────────────────┘  │
                                                            │ E2E encrypted frames
┌──────────────── operator's VPS ───────────────┐           │
│  relay: WebSocket forwarder, room = H(boxPub) │◄──────────┘
│         serves PWA static files               │◄──────────┐
│         holds Web Push subscriptions          │           │
└───────────────────────────────────────────────┘           │
                                                            │
┌──────────────── phone / laptop ───────────────┐           │
│  pwa: Vue 3, CodeMirror 6, IndexedDB cache    │───────────┘
└───────────────────────────────────────────────┘
```

Three deployables, one shared package (`packages/protocol`) holding the wire types, codecs and crypto helpers used by all three.

## Trust model

- **Box** is fully trusted. It runs agents with permissions bypassed. Anyone who can execute on the box owns everything.
- **PWA device** is trusted once paired. Pairing proves possession of a one-time secret shown on the box's terminal. Trust is per device (per client keypair) and revocable from the box.
- **Relay** is untrusted. It sees: room ids (hash of a public key), connection timing, frame sizes, and Web Push endpoints. It never sees plaintext, keys, repo names, or which device is which beyond "host" and "guest".
- **Network** is untrusted. All frames are AES-GCM under a per-connection key derived from X25519 (static+ephemeral), see `protocol.md`.

Compromise of the relay yields traffic analysis only. Compromise of a paired device yields the box. That is the intended trade for a single-operator tool; write it down so nobody is surprised later.

## Daemon

Single Node 24 process. Responsibilities, in order of importance:

1. **Event log.** One SQLite database (`node:sqlite`), table `events(session, seq, ts, type, payload)`, primary key `(session, seq)`. Append-only. `seq` is per session, gapless, starts at 1. This is the source of truth for everything the PWA shows. Streaming text deltas are _not_ logged; they go over an ephemeral channel and the final message is logged once.
2. **Sessions.** A session = one agent process + one worktree + one event log stream. Session state is a small row: repo, worktree path, branch, agent kind, agent-native session id (for resume), state (`idle | running | waiting_user | ended`). On daemon restart, sessions are reattached using the agent's own resume mechanism.
3. **Adapters.** Per agent kind, split into a read side and a write side (see below).
4. **Flux tools.** A stdio MCP server, spawned by the agent, that calls back into the daemon over a local Unix socket. Provides `flux_ask` and `flux_notify`. This is how "the agent needs you" happens; the agent's own interactive tools are absent in headless mode.
5. **Git and fs service.** Worktree create/list/remove, status, diff (against branch base and against HEAD), show, log, file read, file write (P2). Executed by spawning `git`; no git library.
6. **Transport.** One outbound WebSocket to the relay, reconnecting with backoff. Handshake and encryption per `protocol.md`. Multiplexes: event stream (replayable), ephemeral stream (deltas, presence), RPC (request/response).
7. **Pairing.** `flux daemon` on first run generates the box keypair. `flux pair` prints a QR containing `https://<relay>/#<boxPub>.<secret>`. Paired device public keys live in the daemon's SQLite.

### Adapter: read side and write side

The read side must work regardless of how the agent was launched. The write side is an interface with more than one implementation. This split is deliberate and is the mitigation for the policy risk in `prd.md`.

**Claude Code, read side.** Two sources, same parser:

- stdout of `claude -p --output-format stream-json --verbose` (live)
- `~/.claude/projects/<slug>/<session_id>.jsonl` (recovery, and any session Flux did not start)

Both carry the same `assistant` / `user` message objects. Mapping (verified against Claude Code 2.1.251):

| stream line                                   | FluxEvent                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| `system/init`                                 | `session.created` (also stores `session_id` for resume)                          |
| `system/status` `requesting`                  | `session.state running`                                                          |
| `stream_event` `content_block_delta` text     | ephemeral delta, not logged                                                      |
| `assistant` with `text` block                 | `msg.assistant`                                                                  |
| `assistant` with `tool_use` block             | `tool.start`                                                                     |
| `user` with `tool_result` + `tool_use_result` | `tool.end`, and `files.changed` when `tool_use_result` reports a file write/edit |
| `result`                                      | `turn.ended` (cost, duration, token usage), `session.state idle`                 |
| `rate_limit_event`                            | `rate_limit` (utilisation per window)                                            |
| hooks, anything else                          | `raw`                                                                            |

**Claude Code, write side.** `AgentInput` interface: `send(text)`, `interrupt()`, `close()`. Implementations:

- `StreamJsonInput`: writes `{"type":"user","message":{"role":"user","content":"…"}}` lines to stdin of a long-lived `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --dangerously-skip-permissions [--resume <id>]` process. Default.
- `PtyInput`: drives interactive `claude` in a pseudo-terminal. Fallback if the headless path becomes unavailable. Also the path for agents that only have a TUI.

**pi.dev.** P2. Same shape: read from whatever structured output pi provides (or its transcript), write via stdin or PTY.

### Flux tools (MCP)

`apps/daemon` ships a tiny MCP stdio server binary. The daemon writes a per-session `.mcp.json` pointing at it and passes `--mcp-config` to the agent. Tools:

- `flux_ask(question: string, options?: string[]) -> string`. Emits an `ask` event, blocks until the operator answers (from PWA or notification), returns the answer. Times out after a configurable period with a clear error so the agent can proceed sensibly.
- `flux_notify(summary: string, level: 'info' | 'done' | 'blocked')`. Emits `notify`. Non-blocking.

Box-side `CLAUDE.md` instructs the agent to prefer `flux_ask` over guessing on material decisions. Because Flux owns these tools, the `ask` schema is stable across agents and Claude Code versions.

## Relay

Hono on Node 24. Two jobs:

1. `GET /*` serves the PWA build.
2. `GET /ws/:room` WebSocket. First frame declares role `host` or `guest`. One host per room; the second host is rejected. Frames from host fan out to all guests; frames from a guest go to the host only. Frames are opaque binary. No persistence, no logging of room ids beyond ephemeral metrics.
   The relay holds no state beyond live connections. Web Push is sent by the daemon directly (`adr/0013`).

Limits: max frame size, max guests per room, per-IP connection rate. All hard-coded initially.

## PWA

Vue 3 (Composition API, `<script setup lang="ts">`), Vite, CodeMirror 6 with `@codemirror/merge` for diffs. IndexedDB holds the client keypair, the paired box (pubkey, relay URL), and a cache of the event log per session so the app renders instantly and then syncs.

Screens (P1): pair (camera via `BarcodeDetector`), sessions list / tabs, session view (chat + tool timeline), changes (file list → diff view with line comments and a comment tray), new session. Settings is P2.

State: one store per session holding `events[]`, `lastSeq`, `pendingComments[]`, `streaming` (current delta buffer). A connection store holds socket state and the RPC client.

## Sync model

- Box is the only source of truth. No buffering on the relay. If the box is offline the PWA shows cached state and a disconnected banner.
- On connect (or reconnect) the PWA sends `events.sync { session, since: lastSeq }` for each open session. The daemon replays `seq > since`. Because `seq` is gapless the client detects any gap and re-syncs.
- Live events are pushed as they are appended. The client applies an event only if `seq === lastSeq + 1`, otherwise it triggers a sync. This makes duplicates and reordering harmless.
- Ephemeral deltas carry the `seq` of the `msg.assistant` they will become, so the client can discard them when the final message arrives.

## Notifications

Triggered by the daemon on `ask` and on `session.state idle` (after `running`) and on `notify done|blocked`. The daemon holds the subscriptions (`push.subscribe`) and sends Web Push itself, encrypted per RFC 8291 and signed with its VAPID key (`adr/0013`). Content stays minimal: session id and event type. The service worker opens the right session on tap.

## Failure modes

| Failure            | Behaviour                                                                    |
| ------------------ | ---------------------------------------------------------------------------- |
| Relay down         | Daemon and PWA both reconnect with backoff. Nothing lost; box keeps logging. |
| Box down           | PWA shows cached state, disconnected. No pretence of being live.             |
| Daemon restarts    | Sessions resumed via agent `--resume`. Event log intact. PWA re-syncs.       |
| Agent process dies | `session.state ended` with reason. Operator can restart from PWA.            |
| Phone backgrounded | Socket dies. Push still arrives. Reopen → sync.                              |
| Paired device lost | `flux devices rm <id>` on the box.                                           |

## Deployment

- Box: `pnpm dlx` or a single bundled `flux` binary via tsdown output; systemd unit template provided. Requires `git`, `claude` (and later `pi`) on PATH.
- Relay: single Node process behind Caddy or nginx for TLS. Serves PWA from `apps/pwa/dist`.
- PWA: built once, served by the relay. No separate hosting.

## Out of scope for this document

Wire format, crypto and schemas: `protocol.md`. Tooling and rules: `engineering.md`. Why each decision: `adr/`.
