# Flux: product requirements

Status: draft v1, 2026-08-28. Owner: Rich Henderson.

## One line

Give coding agents their own computer, then steer and review them from a phone or laptop through a small, fast, native-feeling GUI.

## Problem

Coding agents (Claude Code today, pi.dev next) do their best work when they are allowed to run unattended with full permissions on long tasks. Doing that on a personal machine is unsafe and ties the machine up. Running them on a remote box fixes both, but the only remote interface is a terminal, which on a phone is unreadable and on a laptop is still a poor way to review diffs and give structured feedback.

Existing tools (herdr for local session management, Orca for remote terminal control) each solve part of this. Neither gives a purpose-built remote review-and-steer surface, and neither is shaped for the "agents live on a box" model.

## Users

Phase 1 has exactly one user: the author. Everything is designed for a single operator with one or more boxes and one or more devices. Multi-user, teams and hosted offerings are explicit non-goals until the single-operator experience is excellent.

## Goals

1. Run agents on a box (VPS or container) with permissions bypassed, on long tasks, without a human terminal attached.
2. From a phone or laptop: see what each agent is doing, read its messages, read the code it changed as diffs, comment on specific lines, and send messages. Work on several agents at once, each in its own git worktree.
3. Get notified when an agent needs a decision or has finished.
4. Zero third-party accounts. Zero paid infrastructure beyond a VPS the operator already has. Pairing is "run daemon, scan QR, connected".
5. The relay learns nothing: it passes encrypted bytes between parties it cannot identify.
6. Small, dependency-light, maintainable codebase that agents can extend safely under strict rules (see `engineering.md`).

## Non-goals (phase 1)

- Multi-user, permissions, roles, sharing sessions between people.
- A terminal emulator in the remote. If a terminal is needed, ssh to the box.
- Running agents on the phone or laptop. The box is the only execution environment.
- iOS. Android first via PWA; iOS follows when the product has proven itself.
- Persisting anything on the relay. If the box is offline the remote is offline.
- Replacing the agent's own config formats. Claude Code keeps `settings.json`, `CLAUDE.md`, `.mcp.json`; Flux edits them in place where needed.
- A hosted service.

## Parts

- **daemon**: runs on the box. Spawns and supervises agents, one per session, each in its own worktree. Watches their output, normalises it into a per-session event log, exposes git and file operations, injects Flux tools into each agent. Holds one outbound connection to the relay.
- **relay**: runs on the operator's VPS. Stateless WebSocket forwarder keyed by room. Also serves the PWA as static files. Knows nothing beyond room ids.
- **pwa**: the remote. Installable web app. Chat per session, diff and file viewer with line comments, session tabs, settings, pairing via QR scan.

See `architecture.md` for how they fit together and `protocol.md` for the wire format.

## Core user stories

Ordered by priority. P1 is the minimum useful product.

### P1

- As the operator I ssh to the box, run `flux daemon`, and a QR appears. I scan it with my phone and the PWA is connected. No accounts, no config files.
- I create a session: pick a repo on the box, pick or create a branch, and a worktree plus an agent are started.
- I send the agent a message and watch its reply stream in.
- I see each tool call the agent makes (name, short summary), and whether it succeeded.
- I see the list of files the agent has changed in this session, and can open any as a diff against the branch base.
- I select lines in a diff and leave a comment. Comments queue up. I hit send and they go to the agent as one message with file and line references.
- I have several sessions open as tabs and can switch between them instantly.
- The agent can ask me a question (via a Flux tool) and I get a push notification. I answer from the notification or the app, and the agent continues.
- I get a notification when a session goes idle after running.
- If my phone loses connection, on reconnect the app catches up from where it left off with no gaps and no duplicates.
- If the daemon restarts, existing sessions are resumed, not lost.
- I can see what each session has cost and where I stand against my rate-limit windows, so I can decide what to start next.

### P2

- Edit a file directly in the PWA and save it to the worktree.
- Edit the box-side Flux config and the agent's config (`CLAUDE.md`, `settings.json`) from the PWA.
- Pair a second device. Revoke a device.
- Basic git actions from the PWA: commit, push, open PR (via `gh` on the box).
- pi.dev adapter.
- Save named Agents (a model + effort + role preset) in Settings and pick one when starting a session (ADR 0023).
- Ask flux about itself: a built-in manual reachable three ways — `flux help [term]` on the box, a `flux_help` tool every agent has, and a seeded read-only "Help" Agent — so an operator or agent can look up how flux works without leaving the app (ADR 0008).

### P3

- Desktop shell (Tauri or Electron-lite) if the PWA proves limiting on desktop.
- iOS.
- Multiple boxes from one PWA.
- Session templates (repo + branch naming + agent config).

## Success criteria for phase 1

- The author uses Flux instead of ssh+tmux for a full working week of agent-driven development.
- Time from `flux daemon` to first message sent from the phone: under 60 seconds on a fresh box.
- Reconnect after network loss shows no missing or duplicated messages in 100 out of 100 tries.
- The PWA cold-loads on a mid-range Android phone in under 2 seconds on 4G.
- Total runtime dependencies across all three apps: fewer than 10 (see `engineering.md`).

## Risks

| Risk                                                                                                                                        | Impact                                  | Mitigation                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Anthropic restricts `claude -p` / stream-json use under subscription plans                                                                  | Write side of the Claude adapter breaks | Read side uses transcript files and hooks, which are independent of launch mode. Write side is an interface with two implementations: stream-json stdin and a PTY driver. Flip a flag. See `adr/0007`. |
| Headless Claude Code has no built-in way to ask the user anything (verified: `AskUserQuestion` and plan-mode tools are absent in `-p` mode) | No "agent needs you" signal             | Flux injects its own MCP tools (`flux_ask`, `flux_notify`). Agent-agnostic. See `adr/0008`.                                                                                                            |
| Android kills background WebSockets                                                                                                         | Missed notifications                    | Web Push via the relay for `ask` and idle events. The relay holds only push subscriptions, which are opaque endpoints.                                                                                 |
| Vite+ is pre-1.0                                                                                                                            | Tooling churn                           | Every underlying tool (Vite, Vitest, Oxlint, Oxfmt) is stable on its own. `vp` is a convenience layer that can be dropped without config changes.                                                      |
| Solo project, many agent-written contributions                                                                                              | Drift, inconsistency                    | `engineering.md` is enforced by tooling, not by memory. ADRs record every decision.                                                                                                                    |

## Licence

Dual-licensed MIT or Apache-2.0, at the user's option (the Rust ecosystem convention). Free as in freedom; nothing here will be enforced. Contributions are accepted under the same dual licence.
