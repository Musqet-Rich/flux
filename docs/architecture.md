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
│  flux tools (mcp, ext) ─┘   ├─ git / fs service        │
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
4. **Flux tools.** A stdio MCP server, spawned by the agent, that calls back into the daemon over a local Unix socket. Provides `flux_ask` and `flux_notify`. This is how "the agent needs you" happens; the agent's own interactive tools are absent in headless mode. pi has no MCP client, so for pi the same two tools are a pi extension that speaks to the same socket (ADR 0016).
5. **Git and fs service.** Worktree create/list/remove, status, diff (against branch base and against HEAD), show, log, file read, file write, and the operator's git actions: commit (all changes or chosen paths), push (never forced; the first push of a branch sets its upstream) and open a pull request through `gh` (`adr/0014`), which also logs `pr.published` so the PWA learns of a PR the same way whether the operator or the agent opened it. Executed by spawning `git` and `gh` with an argument vector and a timeout (`run-command.ts`); no git library, no shell strings. Reads cap at 1 MiB (`truncated`), carry a sha256 of the whole file, and call anything that is not valid UTF-8 binary. A write is atomic (temp file with the old mode, then rename), refuses any path that lexically or through a symlink leaves the worktree or has a `.git` segment, writes through an in-worktree symlink, and with `ifMatch` only lands when the file still has the hash it was read with (`conflict` otherwise). Writes to one file are queued on the box, so two devices cannot both win; an agent's own write between check and rename is the accepted gap.
6. **Transport.** One outbound WebSocket to the relay, reconnecting with backoff. Handshake and encryption per `protocol.md`. Multiplexes: event stream (replayable), ephemeral stream (deltas, presence), RPC (request/response).
7. **Pairing.** `flux daemon` on first run generates the box keypair. `flux daemon` and `flux pair` print a QR containing `https://<relay>/#<boxPub>.<secret>` above the URL. The encoder is in-house (`src/qr/`, no dependency per ADR 0010): byte mode, error correction level M, versions 1 to 15, rendered with Unicode half blocks so it fits a terminal. Paired device public keys live in the daemon's SQLite, with when each was paired and last said hello. Any number of devices can pair while others are connected; revoking one (`devices.remove` from a device, or `flux devices rm`) deletes its key and push subscriptions and tells its live channel (`device.revoked`, `protocol.md` § 6) before dropping it.
8. **Settings.** Runtime settings the operator may change from the PWA (repositories directory, default agent, which events push) live in the `settings` table and override the environment's starting values; environment-only values (relay URL, data dir, push subject, agent binary) are reported read-only. The agent's global config (`~/.claude/CLAUDE.md`, `~/.claude/settings.json`) is read and written as raw text (temp file and rename), with `settings.json` checked to be a JSON object before it touches disk (ADR 0016).

### Adapter: read side and write side

The read side must work regardless of how the agent was launched. The write side is an interface with more than one implementation. This split is deliberate and is the mitigation for the policy risk in `prd.md`.

**Claude Code, read side.** Two sources, same parser:

- stdout of `claude -p --output-format stream-json --verbose` (live)
- `~/.claude/projects/<slug>/<session_id>.jsonl` (recovery, and any session Flux did not start)

Both carry the same `assistant` / `user` message objects. Mapping (verified against Claude Code 2.1.251):

| stream line                                                                                                | FluxEvent                                                                                                             |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `system/init`                                                                                              | `session.created` (also stores `session_id` for resume)                                                               |
| `system/status` `requesting`                                                                               | `session.state running`                                                                                               |
| `stream_event` `content_block_delta` text                                                                  | ephemeral delta, not logged                                                                                           |
| `assistant` with `text` block                                                                              | `msg.assistant`                                                                                                       |
| `assistant` with `tool_use` block                                                                          | `tool.start`                                                                                                          |
| `user` with `tool_result` + `tool_use_result`                                                              | `tool.end`, and `files.changed` when `tool_use_result` reports a file write/edit                                      |
| `result`                                                                                                   | `turn.ended` (cost, duration, token usage), `session.state idle`                                                      |
| `rate_limit_event`                                                                                         | `rate_limit` (utilisation per window)                                                                                 |
| `stream_event` `content_block_start` thinking, `system/thinking_tokens`, that block's `content_block_stop` | ephemeral `agent.thinking` (on, count, off), not logged; the adapter throttles counts to one per 500 ms or 100 tokens |
| `system/task_started`, `system/task_notification`                                                          | `task.started`, `task.ended`                                                                                          |
| `system/code_change_published`                                                                             | `pr.published` (the agent opened a PR with `gh`)                                                                      |
| `system/vcs_state_changed`                                                                                 | ephemeral `vcs.changed`, not logged                                                                                   |
| `system/hook_response` with outcome ≠ success                                                              | `hook.failed` (stderr capped at 2 KiB)                                                                                |
| successful hooks, other stream envelopes, anything else                                                    | `raw`                                                                                                                 |

**Claude Code, write side.** `AgentInput` interface: `send(text)`, `interrupt()`, `close()`. Implementations:

- `StreamJsonInput`: writes `{"type":"user","message":{"role":"user","content":"…"}}` lines to stdin of a long-lived `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --dangerously-skip-permissions [--resume <id>]` process. Default.
- `PtyInput`: drives interactive `claude` in a pseudo-terminal. Fallback if the headless path becomes unavailable. Also the path for agents that only have a TUI.

**pi.dev, both sides** (ADR 0016). One long-lived `pi --mode rpc --session-dir <data>/pi-sessions --session-id <flux session> --no-approve --no-extensions --no-skills --no-prompt-templates --extension <flux-pi-extension> --append-system-prompt …` per session (nothing from `~/.pi` is loaded; context files are), `--provider`/`--model` from `FLUX_PI_PROVIDER`/`FLUX_PI_MODEL` when set. The Flux session id is pi's session id, so a restart resumes with the same arguments. Write side: `{"type":"prompt","message":…,"streamingBehavior":"followUp"}` lines to stdin; interrupt is `{"type":"abort"}` and keeps the process (a flux_ask in flight is released as `ask.answered by: aborted`). The last 2000 bytes of pi's stderr go into the `ended` reason. Read side, the JSON lines on stdout (verified against pi 0.84.4; fixtures under `apps/daemon/test/fixtures/pi`):

| rpc line                                                                                                                                                    | FluxEvent                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `agent_start`                                                                                                                                               | `session.state running`                                                                                                  |
| `message_update` with `text_delta`                                                                                                                          | ephemeral delta, not logged                                                                                              |
| `message_end`, role `assistant`, `text` blocks                                                                                                              | `msg.assistant`; usage and cost summed into the run                                                                      |
| `message_end`, role `assistant`, `stopReason: error`                                                                                                        | `raw` with pi's `errorMessage`                                                                                           |
| `tool_execution_start`                                                                                                                                      | `tool.start`                                                                                                             |
| `tool_execution_end`                                                                                                                                        | `tool.end`, and `files.changed` after a successful `write`, `edit` or `bash`                                             |
| `agent_settled`                                                                                                                                             | `turn.ended` (summed cost and tokens, `numTurns` = assistant messages, last `stopReason`), `session.state idle`          |
| `response` with `success: false`                                                                                                                            | `raw`                                                                                                                    |
| `auto_retry_start/end`, `compaction_start/end`, `summarization_retry_scheduled`, `extension_error`, `hook_error`, `extension_ui_request`                    | `raw` notice with only the telling fields (attempt, delay, reason, error, method); a dialog is also answered `cancelled` |
| `response` ok, `turn_*`, `message_start`, user and tool-result `message_end`, `agent_end`, `tool_execution_update`, `queue_update`, `bash_execution_update` | dropped                                                                                                                  |
| anything else                                                                                                                                               | `raw`                                                                                                                    |

pi's own tools are lower-case (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`); `pi-tool-summary.ts` renders those and the Flux tools. No `durationMs`: the stream carries no end time.

### Flux tools (MCP, and a pi extension)

`apps/daemon` ships a tiny MCP stdio server binary. The daemon writes a per-session `.mcp.json` pointing at it and passes `--mcp-config` to the agent. For pi, which has no MCP client, the daemon ships the same two tools as a pi extension (`dist/flux-pi-extension.mjs`, passed with `--extension`) that calls the same control socket with the same request lines (ADR 0016). Tools:

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

Screens (P1): pair (camera via `BarcodeDetector`), sessions list / tabs, session view (chat + tool timeline), changes (file list → diff view with line comments and a comment tray; plus the P2 git actions: tick files, commit, push, open a PR and get its link), new session. P2 so far also: an editor for one worktree file, reached from the changes list or the diff view. Settings (P2, built): paired devices with revoke, the box's runtime settings with the environment-only values shown read-only, and the agent's global config as two editors.

State: one reactive store for the app. It holds the connection (status, daemon name, last error, push state, rate-limit windows), the session list, and one log view per opened session with `events[]`, `lastSeq`, `streaming` (current delta buffer), `thinking` (the agent's open thinking block and token estimate, from `agent.thinking`) and `changes` (a counter bumped by `vcs.changed`). Pending comments, the open ask and the session's PR are derived from the events, not stored.

Layout of `apps/pwa/src`, as built:

- `client/`: connection, RPC client, session log, sync, pairing, storage. No Vue; runs in Node against `test/fake-relay.ts`.
- `store/`: one reactive store (`createStore`) over storage plus connection: boot, pair, open a session (cache first, then `events.sync`), send, answer, comments, session list, push subscription, save a file, devices and settings (`settings-actions.ts`). Actions a view fires resolve to a boolean and put their failure in `state.error` for the status bar; `saveFile` alone resolves to an outcome, because a `conflict` is the editor's to handle (it offers a reload or an overwrite) rather than the status bar's. `state.drafts` holds unsaved editor text per session and path, in memory only. A `device.revoked` notice naming this device, or a `not_paired` answer after pairing, forgets the stored keys and the cached logs and returns to the pair screen (`boxLink.unpair`). The push subscription is stored on the box after `hello` if permission is already granted (the Pair tap asks for it), otherwise the status bar offers "Enable notifications" so the permission dialog runs under a gesture. The cache is append-only, in chunks of 256 events per storage key. `app-store.ts` binds it to IndexedDB and the native WebSocket. Pending comments, the open ask and the session's pull request are derived from the log (`pendingComments`, `openAsk`, `sessionPr`), never stored separately.
- `router/`: a hand-rolled route switch (ADR 0004) over `history.pushState`: `/`, `/new`, `/settings`, `/s/<id>`, `/s/<id>/changes`, `/s/<id>/diff?path=…`, `/s/<id>/edit?path=…`. The URL fragment is reserved for pairing links.
- `components/`: `Pair`, `Shell` (tabs, gear to settings, routed screen, status bar), `SessionTabs` (one tab per session in creation order, `createdAt` then id, never re-sorted on activity; the state dot and a count of events since the tab was last active show where the work is, and the strip scrolls only when the operator selects or creates a session), `SessionView` (timeline, streaming text or a "Thinking… ~1.2k tokens" indicator while the agent is inside a thinking block, a PR link in the header once the log has a `pr.published`, `AskCard`, `CommentTray`, composer; the timeline skips `raw` and `rate_limit` events, which stay in the log: hooks and streaming envelopes would otherwise put half a dozen bare rows around every reply, and the status bar is where rate limits show; the timeline follows new content only while the operator is within 32 px of the bottom, otherwise the scroll position stays put and a `↓ N new` pill offers to catch up, and sending, answering or opening a session always jumps to the end: `composables/useTailScroll`), `ChangesView` (file list with tick boxes and an Edit button per file, refetched when a `vcs.changed` notice arrives, embedding `GitActions`: commit box, push, open PR, the PR link taken from the log), `DiffView`, `EditView` (save with the hash the file was read with, keeping the file's CRLF if it had it; conflict banner offering reload or overwrite; dirty mark; read-only when truncated; unsaved text is kept as a draft in the store, so any way of leaving, tab, back button or route change, is recoverable and only closing the tab warns; the editor module is loaded on demand so other screens do not carry CodeMirror's commands), `NewSessionView`, `SettingsView` (`DevicesSection`, `FluxSettingsForm`, `AgentConfigEditor`), `StatusBar` (connection, rate-limit windows on one line as `5h 13% · 7d 24%`, with `five_hour` and `seven_day` shortened and any other window named with spaces only when it is the most used, push offer, last error), `EventItem` (messages as bubbles, tools with their detail behind a tap, lifecycle and task rows as one-line notes, `pr.published` as a link, `hook.failed` as a warning with stderr behind a disclosure, unknown types as their name with the payload behind a tap).
- `markdown/`: the timeline's own Markdown renderer for assistant messages and the streaming bubble (`tokeniseMarkdown` for blocks, `inlineMarkdown` for runs, `renderMarkdown` to VNodes with `h()`). Deliberately partial: paragraphs with line breaks kept, `#`–`###` headings as bold lines, one level of nested list, fenced code (language as a class, no highlighting), `>` quotes, inline code, bold, italic and `http(s)` links opened in a new tab with `noopener noreferrer`; everything else is literal text. No package (engineering.md § Dependencies) and no `v-html`: the agent's text only ever becomes text nodes, so it cannot inject markup. An unclosed fence renders as an open code block, which is what streaming shows mid-reply. The operator's own messages stay plain text as typed.
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

| Failure            | Behaviour                                                                              |
| ------------------ | -------------------------------------------------------------------------------------- |
| Relay down         | Daemon and PWA both reconnect with backoff. Nothing lost; box keeps logging.           |
| Box down           | PWA shows cached state, disconnected. No pretence of being live.                       |
| Daemon restarts    | Sessions resumed via agent `--resume`. Event log intact. PWA re-syncs.                 |
| Agent process dies | `session.state ended` with reason. Operator can restart from PWA.                      |
| Phone backgrounded | Socket dies. Push still arrives. Reopen → sync.                                        |
| Paired device lost | Revoke it from another device's Settings screen, or `flux devices rm <id>` on the box. |

## Deployment

`pnpm run build` runs each package's `build` in dependency order (daemon, relay, pwa; the protocol package is consumed from source and bundled, so it has no build). tsdown config lives in `apps/daemon/tsdown.config.ts` and `apps/relay/tsdown.config.ts`; `@flux/protocol` is bundled into both so neither built app depends on the workspace, node built-ins stay external. `deploy/` holds the systemd units, a Caddyfile and `.env.example` (every `FLUX_*` variable); `README.md` is the quickstart.

- Box: `apps/daemon/dist/index.mjs` (`bin: flux`), `dist/flux-mcp.mjs` (`bin: flux-mcp`, the MCP server the daemon points Claude at) and `dist/flux-pi-extension.mjs` (the pi extension with the same tools); both resolved as siblings of `index.mjs`, or of their `.ts` source when run from source. No runtime dependencies. `deploy/flux-daemon.service` runs it as the `flux` user with `Restart=always` and the hardening a box that runs agents can bear (no privilege escalation, no kernel or `/usr` writes; the home stays writable because agents work there, and there is no system-call filter because Claude Code's sandbox needs mount and user namespaces). The daemon prints the pairing QR at start only on a terminal; under systemd the operator runs `flux pair`. Requires `git` and whichever of `claude` and `pi` the operator wants to run on PATH (or `FLUX_CLAUDE`/`FLUX_PI`; the daemon checks once at start, says so in `hello` and on its console, and refuses `sessions.create` for an agent it did not find with `agent_unavailable`), and `gh` (logged in as the `flux` user) for opening pull requests from the PWA.
- Relay: `apps/relay/dist/index.mjs`, a single Node process bound to `127.0.0.1:8787` behind Caddy (`deploy/Caddyfile`, automatic TLS, HSTS, WebSocket passthrough) with `FLUX_TRUST_PROXY=1`. `hono`, `@hono/node-server` and `ws` are external, so the checkout keeps its `node_modules`. `deploy/flux-relay.service` runs it fully sandboxed (read-only system, no home, no devices). Serves PWA from `apps/pwa/dist`.
- PWA: built once by Vite, served by the relay. No separate hosting. For development, `pnpm --filter @flux/pwa dev` serves the source with HMR on :5173 and proxies `/ws` and `/healthz` to a relay at `FLUX_DEV_RELAY` (default `http://127.0.0.1:8787`), so the page origin still resolves to the box; the service worker is not registered under the dev server (`README.md` § Development).
- `apps/daemon/test/built-daemon.test.ts` builds the daemon into a temp dir under the real config and runs both files, so `pnpm run check` fails if the production build breaks.
- `e2e/` runs this whole shape on one machine: the built relay serving the built PWA on an ephemeral port, the built daemon in a temp data dir with `FLUX_CLAUDE` pointing at the fixture-replaying fake, pairing through the URL `flux pair` prints, and Chromium under Playwright as the device (`docs/engineering.md` § Testing).

## Out of scope for this document

Wire format, crypto and schemas: `protocol.md`. Tooling and rules: `engineering.md`. Why each decision: `adr/`.
