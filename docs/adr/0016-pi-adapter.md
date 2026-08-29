# 0016: pi adapter: RPC mode, session id shared with Flux, Flux tools as a pi extension

Status: accepted, 2026-08-29.

## Context

PRD P2 story 5: run pi.dev under Flux with the same remote as Claude Code. Verified on pi 0.84.4:

- pi has three headless surfaces. `-p` is one-shot. `--mode json` streams events for one prompt and exits. `--mode rpc` keeps a process alive and takes JSON commands on stdin (`prompt`, `abort`, `steer`, `follow_up`, …), streaming the same events as json mode plus a `response` per command.
- pi has no MCP client ("intentionally does not include built-in MCP", pi's usage.md). Custom tools come from extensions: a TypeScript or JavaScript module with a default export that calls `pi.registerTool(...)`, loaded with `--extension <path>` through jiti.
- Sessions are JSONL files under a session directory keyed by cwd. `--session-id <id>` creates the session when it does not exist and resumes it when it does; `--session-dir` puts the files where the daemon wants them.
- pi reports usage and cost per assistant message, never per run. Its `message_end` timestamp is the message's start time. In RPC mode there is no `session` header line.
- `--no-approve` skips the trust prompt for project-local pi files, which nobody could answer in headless mode. Extensions, skills and prompt templates from `~/.pi/agent` are discovered by default; an extension that opens a dialog (`extension_ui_request`) would block a headless run until answered.

## Decision

1. **Write side: `pi --mode rpc --no-approve --no-extensions --no-skills --no-prompt-templates`**, one long-lived process per session (`src/pi/spawn-pi.ts`). Nothing from `~/.pi` is loaded: a run must not depend on what an operator installed there, and a dialog-opening extension would stall it; context files (`AGENTS.md`, `CLAUDE.md`) still load and the Flux extension is passed explicitly. Any dialog request that still arrives is answered `cancelled` at once and logged as a `raw` notice. A user message is `{"type":"prompt","message":…,"streamingBehavior":"followUp"}` (the behaviour only applies while pi is streaming, so it is always sent and a second message during a run queues instead of erroring). Interrupt is `{"type":"abort"}`: the run ends with `stopReason: aborted` and the process stays for the next prompt. pi aborts a running tool's `AbortSignal` too; the Flux extension hangs up its control-socket connection on that, and the daemon settles the pending ask as `by: 'aborted'` (control socket → ask registry), so an interrupt during `waiting_user` frees the session at once instead of after the ask timeout. Lines are split by hand on LF; `node:readline` also splits on U+2028/U+2029, which pi's docs call out as a protocol violation.
2. **Resume: the Flux session id is pi's session id.** Every spawn passes `--session-id <flux session> --session-dir <dataDir>/pi-sessions`, so a restart resumes with the same arguments and the daemon stores nothing extra. The `resume.jsonl` fixture shows pi recalling the previous run this way.
3. **Read side** (`parse-pi-line.ts`, `map-pi-line.ts`): `agent_start` → running; `message_update` text deltas → ephemeral; assistant `message_end` → `msg.assistant` (text blocks) and usage summed into the run; `tool_execution_start/end` → `tool.start`/`tool.end` (`write`, `edit`, `bash` flag `files.changed`); `agent_settled` → one `turn.ended` with the summed cost and tokens, `numTurns` = assistant messages, `stopReason` of the last one, then idle. A failed call (`stopReason: error`) is logged `raw` with pi's error text. Successful `response` lines and lifecycle chatter (`turn_*`, `message_start`, user and tool-result `message_end`, `agent_end`) are dropped; failed responses and anything unknown are `raw`. No `durationMs`: the stream carries no end time.
4. **Flux tools as a pi extension** (`src/pi/flux-pi-extension.ts`, built to `dist/flux-pi-extension.mjs`, passed with `--extension`). It registers `flux_ask` and `flux_notify` with the same descriptions and JSON schemas as `flux-mcp.ts` and forwards each call over the control socket with the same request lines, reading `FLUX_CONTROL_SOCKET` and `FLUX_SESSION` from the environment the daemon spawns pi with. The schemas are plain JSON-schema objects (pi accepts them as TypeBox output), so the extension imports nothing but `node:net`. The same `--append-system-prompt` text as for Claude tells pi when to use them. This is the one non-SFC, non-config file with a default export: pi's contract, noted in `engineering.md`.
5. **Adapter seam in the supervisor.** `createSessionSupervisor` takes an `AgentAdapter` (`mapLine`, `reset`) and a spawn function; the pool picks `claudeAdapter`/`spawnClaude` or `piAdapter`/`spawnPi` from the session's agent kind. `AgentProcess` gains `interrupt()`: SIGTERM for Claude (no in-band abort), `abort` for pi.
6. **Availability.** `detect-agents.ts` checks once at start which binaries are executable (`FLUX_CLAUDE`/`FLUX_PI`, or `claude`/`pi` on PATH). `hello` reports the list in the new optional `agents` field (protocol.md § 7); `sessions.create` for an absent agent is `agent_unavailable`; the PWA shows an agent picker only when the box has more than one. `FLUX_PI_PROVIDER`/`FLUX_PI_MODEL` map to pi's `--provider`/`--model`; unset, pi's own `settings.json` decides.

## Consequences

- No new dependency. The extension is self-contained and shipped by the daemon build.
- The operator's `~/.pi` extensions, skills and prompt templates are not loaded under Flux (see 1). Project context files are.
- pi's stderr tail (2000 bytes) becomes part of the `session.state ended` reason, so an auth failure as the `flux` user is visible from the phone.
- On `sessions.archive` the daemon deletes pi's session file for that session (`<data>/pi-sessions/**/<ts>_<session>.jsonl`); Claude's transcript is left where Claude keeps it (ADR 0007 reads it).
- pi's cost figures come from its model catalogue, not the provider; treat `costUsd` as an estimate.
- Fixtures under `test/fixtures/pi` were captured with `--provider anthropic --model claude-haiku-4-5`; another provider changes usage numbers, not shapes. Re-capture with `capture.ts` when pi changes shape.
- The read side does not read pi's session file; if the RPC stream ever loses information the file has, the adapter gains a second source the way the Claude one has (ADR 0007).
