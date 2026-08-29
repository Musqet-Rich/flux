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
5. **Git and fs service.** Worktree create/list/remove, status, diff (against branch base and against HEAD), show, log, file read, file write, and the operator's git actions: commit (all changes or chosen paths), push (never forced; the first push of a branch sets its upstream) and open a pull request through `gh` (`adr/0014`). Executed by spawning `git` and `gh` with an argument vector and a timeout (`run-command.ts`); no git library, no shell strings. Reads cap at 1 MiB (`truncated`), carry a sha256 of the whole file, and call anything that is not valid UTF-8 binary. A write is atomic (temp file with the old mode, then rename), refuses any path that lexically or through a symlink leaves the worktree or has a `.git` segment, writes through an in-worktree symlink, and with `ifMatch` only lands when the file still has the hash it was read with (`conflict` otherwise). Writes to one file are queued on the box, so two devices cannot both win; an agent's own write between check and rename is the accepted gap.
6. **Transport.** One outbound WebSocket to the relay, reconnecting with backoff. Handshake and encryption per `protocol.md`. Multiplexes: event stream (replayable), ephemeral stream (deltas, presence), RPC (request/response).
7. **Pairing.** `flux daemon` on first run generates the box keypair. `flux daemon` and `flux pair` print a QR containing `https://<relay>/#<boxPub>.<secret>` above the URL. The encoder is in-house (`src/qr/`, no dependency per ADR 0010): byte mode, error correction level M, versions 1 to 15, rendered with Unicode half blocks so it fits a terminal. Paired device public keys live in the daemon's SQLite.

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

The daemon appends a short system prompt (`--append-system-prompt`) instructing the agent to prefer `flux_ask` over guessing on material decisions and to `flux_notify` when done or blocked. Because Flux owns these tools, the `ask` schema is stable across agents and Claude Code versions.

## Relay

Hono on Node 24. Two jobs:

1. `GET /*` serves the PWA build.
2. `GET /ws/:room` WebSocket. First frame declares role `host` or `guest`. One host per room; the second host is rejected. Frames from host fan out to all guests; frames from a guest go to the host only. Frames are opaque binary. No persistence, no logging of room ids beyond ephemeral metrics.
   The relay holds no state beyond live connections. Web Push is sent by the daemon directly (`adr/0013`).

Limits: max frame size, max guests per room, per-IP connection rate. All hard-coded initially. Behind a reverse proxy every socket is the proxy's address, so the deployment sets `FLUX_TRUST_PROXY=1` and the rate key is the last hop of `X-Forwarded-For` (`client-key.ts`); without the flag the header is ignored.

## PWA

Vue 3 (Composition API, `<script setup lang="ts">`), Vite, CodeMirror 6 with `@codemirror/merge` for diffs. IndexedDB holds the client keypair, the paired box (pubkey, relay URL), and a cache of the event log per session so the app renders instantly and then syncs.

Screens (P1): pair (camera via `BarcodeDetector`), sessions list / tabs, session view (chat + tool timeline), changes (file list → diff view with line comments and a comment tray; plus the P2 git actions: tick files, commit, push, open a PR and get its link), new session. P2 so far also: an editor for one worktree file, reached from the changes list or the diff view. Settings is P2.

State: one reactive store for the app. It holds the connection (status, daemon name, last error, push state, rate-limit windows), the session list, and one log view per opened session with `events[]`, `lastSeq` and `streaming` (current delta buffer). Pending comments and the open ask are derived from the events, not stored.

Layout of `apps/pwa/src`, as built:

- `client/`: connection, RPC client, session log, sync, pairing, storage. No Vue; runs in Node against `test/fake-relay.ts`.
- `store/`: one reactive store (`createStore`) over storage plus connection: boot, pair, open a session (cache first, then `events.sync`), send, answer, comments, session list, push subscription, save a file. Actions a view fires resolve to a boolean and put their failure in `state.error` for the status bar; `saveFile` alone resolves to an outcome, because a `conflict` is the editor's to handle (it offers a reload or an overwrite) rather than the status bar's. `state.drafts` holds unsaved editor text per session and path, in memory only. The push subscription is stored on the box after `hello` if permission is already granted (the Pair tap asks for it), otherwise the status bar offers "Enable notifications" so the permission dialog runs under a gesture. The cache is append-only, in chunks of 256 events per storage key. `app-store.ts` binds it to IndexedDB and the native WebSocket. Pending comments and the open ask are derived from the log (`pendingComments`, `openAsk`), never stored separately.
- `router/`: a hand-rolled route switch (ADR 0004) over `history.pushState`: `/`, `/new`, `/s/<id>`, `/s/<id>/changes`, `/s/<id>/diff?path=…`, `/s/<id>/edit?path=…`. The URL fragment is reserved for pairing links.
- `components/`: `Pair`, `Shell` (tabs, routed screen, status bar), `SessionTabs`, `SessionView` (timeline, streaming text, `AskCard`, `CommentTray`, composer), `ChangesView` (file list with tick boxes and an Edit button per file, embedding `GitActions`: commit box, push, open PR), `DiffView`, `EditView` (save with the hash the file was read with, keeping the file's CRLF if it had it; conflict banner offering reload or overwrite; dirty mark; read-only when truncated; unsaved text is kept as a draft in the store, so any way of leaving, tab, back button or route change, is recoverable and only closing the tab warns; the editor module is loaded on demand so other screens do not carry CodeMirror's commands), `NewSessionView`, `StatusBar`, `EventItem`.
- `editor/`: the CodeMirror unified diff (ADR 0005), the plain text editor behind `EditView` (no language packs yet), and selection-to-line-range mapping. Both editors are mounted inside a shadow root: CodeMirror injects its styles as a `<style>` element, which the relay's CSP (`default-src 'self'`, no `unsafe-inline`) blocks in the document, while in a shadow root it uses a constructed stylesheet, which CSP does not govern.
- `sw.ts`: the service worker, built by Vite as a second entry to `/sw.js` so it is type-checked and linted like everything else. Push → notification; tap → open `/s/<id>`. No fetch caching at P1.
- `styles/base.css`: the only global stylesheet, linked from `index.html`. Colours are custom properties.

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

`pnpm run build` runs each package's `build` in dependency order (daemon, relay, pwa; the protocol package is consumed from source and bundled, so it has no build). tsdown config lives in `apps/daemon/tsdown.config.ts` and `apps/relay/tsdown.config.ts`; `@flux/protocol` is bundled into both so neither built app depends on the workspace, node built-ins stay external. `deploy/` holds the systemd units, a Caddyfile and `.env.example` (every `FLUX_*` variable); `README.md` is the quickstart.

- Box: `apps/daemon/dist/index.mjs` (`bin: flux`) and `dist/flux-mcp.mjs` (`bin: flux-mcp`, the MCP server the daemon points agents at; resolved as a sibling of `index.mjs`, or of `index.ts` when run from source). No runtime dependencies. `deploy/flux-daemon.service` runs it as the `flux` user with `Restart=always` and the hardening a box that runs agents can bear (no privilege escalation, no kernel or `/usr` writes; the home stays writable because agents work there, and there is no system-call filter because Claude Code's sandbox needs mount and user namespaces). The daemon prints the pairing QR at start only on a terminal; under systemd the operator runs `flux pair`. Requires `git`, `claude` (and later `pi`) on PATH, and `gh` (logged in as the `flux` user) for opening pull requests from the PWA.
- Relay: `apps/relay/dist/index.mjs`, a single Node process bound to `127.0.0.1:8787` behind Caddy (`deploy/Caddyfile`, automatic TLS, HSTS, WebSocket passthrough) with `FLUX_TRUST_PROXY=1`. `hono`, `@hono/node-server` and `ws` are external, so the checkout keeps its `node_modules`. `deploy/flux-relay.service` runs it fully sandboxed (read-only system, no home, no devices). Serves PWA from `apps/pwa/dist`.
- PWA: built once by Vite, served by the relay. No separate hosting.
- `apps/daemon/test/built-daemon.test.ts` builds the daemon into a temp dir under the real config and runs both files, so `pnpm run check` fails if the production build breaks.

## Out of scope for this document

Wire format, crypto and schemas: `protocol.md`. Tooling and rules: `engineering.md`. Why each decision: `adr/`.
