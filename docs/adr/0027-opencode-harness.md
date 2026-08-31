# 0027: opencode as a third harness — an NDJSON, process-per-turn adapter

Status: accepted, 2026-08-31.

## Context

Flux abstracts a coding agent as `Harness + Model + Tools + Role` (ADR 0023), with `HarnessKind = 'claude' | 'pi'` and a per-harness adapter pair: a **write side** (`AgentProcess`: spawn, `send`, `interrupt`, `onLine`, `onExit`) and a **read side** (`AgentAdapter.mapLine(line) → Mapped`) that turns the harness's output stream into Flux events. ADR 0023 built the abstraction as a union so a third harness fits without widening the contract. **opencode** (opencode.ai) is a candidate third harness. This ADR records how it maps onto the abstraction and the one place it diverges. It extends ADR 0023 and reuses the ADR 0008 tools-floor mechanism (an injected MCP server).

The shape below is grounded in captured real output (`opencode run --format json`, kept as the adapter fixtures per the fixtures rule) and the CLI/config surface (`opencode run -h`, `opencode mcp add -h`, `opencode agent -h`).

## Decision

1. **`HarnessKind` gains `'opencode'`.** A mechanical, additive protocol change: the union, its guard, the PWA harness label ("opencode"), and the pool's adapter selection. The wire values stay strings; nothing migrates. Fields opencode cannot honour no-op per ADR 0023 §6.

2. **Read side — an NDJSON line adapter, simpler than claude or pi.** `opencode run --format json` emits **newline-delimited JSON**, one self-contained event per line, so `mapLine(line)` is `JSON.parse` + a switch on `type`:
   - `step_start` → step/turn boundary.
   - `text` (`part.text`) → assistant text. (opencode emits whole text _parts_, not token deltas; mapped as message text or one delta.)
   - `tool_use` → a **single** event carrying `part.tool`, `part.callID`, and `part.state.{status,input,output}` — the whole tool call at once, unlike claude which streams start/input-delta/result across lines. Maps to Flux's tool begin+result together.
   - `step_finish` → `part.{reason, tokens{input,output,reasoning,cache{write,read}}, cost}`. Accumulate per step; on the final step (`reason:"stop"`) emit `turn.ended` with summed usage and **real cost** (opencode reports cost directly, unlike pi's estimate). `cache.write→cacheWrite`, `cache.read→cacheRead`.
   - `reasoning`/thinking parts → the thinking indicator (`--thinking`); `error` parts → the session-error path.
     Because events are self-contained, the read side tracks less cross-line state than claude (~620 lines) or pi (~350); estimate ~200 lines.

3. **Write side — process-per-turn, the one genuine divergence.** opencode `run` is invoked per turn (`opencode run --session <id> --continue --format json --auto`), not a long-lived child reading stdin (claude/pi). The opencode `AgentProcess` is therefore a **wrapper that stays logically alive across turns**: `send(text)` spawns a fresh `run` for the stored opencode session id, forwards that run's NDJSON via `onLine`, and — critically — does **not** fire `onExit` when a run completes (a completed run means "turn done", not "session ended"); `onExit` fires only on `close()`. `interrupt()` kills the current run child (SIGINT→SIGTERM→SIGKILL, ADR 0017). The opencode session id (`ses_…`, captured from the first run's `step_start`) is persisted on the Flux session row, exactly as pi's session dir is (ADR 0016). Estimate ~150 lines.

4. **Tools floor via an injected local MCP server (ADR 0008, portable).** opencode supports local MCP servers (`opencode mcp add --env KEY=VALUE`; config `mcp` entries with a command + environment). For every opencode session Flux writes a per-worktree opencode config declaring server `flux` = the same `flux-mcp.mjs` used for claude, with `FLUX_CONTROL_SOCKET` and `FLUX_SESSION` in its env — so `flux_ask`/`flux_notify`/`flux_compact`/`flux_help` are present as the floor, no adapter-specific tool code. (flux-mcp answers `initialize`/`tools/list` without the socket, so the server loads even before a turn.)

5. **Model, effort, role, permissions compile to opencode flags/config.** `model → --model provider/model`; **`effort → --variant`** (opencode's provider reasoning-effort, e.g. `high|max|minimal`); permissions bypass → `--auto`; **role** is injected through the same per-worktree config (an agent `instructions`/`prompt`, or an `AGENTS.md` in the worktree) — Flux's `--append-system-prompt` equivalent. Model/effort remain loose strings (ADR 0023 §3).

6. **Only the Claude compiler shipped first (ADR 0023); opencode is a peer of pi, not a special case.** It reuses the supervisor, event log, transport and tools floor unchanged; it adds an adapter pair and a config writer, nothing structural.

## Consequences

- A third harness lands as an adapter pair + config writer + mechanical wiring — **smaller than the pi adapter**, because opencode's NDJSON events are self-contained. The novel piece is the process-per-turn write-side wrapper.
- Both injection points are confirmed (see Validation): the injected `flux` MCP server connects under opencode, and an injected `AGENTS.md` role is honoured. Neither needed adapter-specific code.
- The captured `--format json` streams (a text turn and a tool turn) are the read-side fixtures (real output, never hand-edited — the fixtures rule).
- Out of scope, later if wanted: streaming text at token granularity (opencode emits whole parts); opencode-specific features (sharing, its own subagents) beyond the neutral spec.

## Validation (2026-08-31)

- **Stream shape:** captured real `opencode run --format json` output for a text turn and a tool turn (the read-side fixtures). Confirms the NDJSON event set in §2, including `tool_use` as one self-contained event and per-step `cost`.
- **Tools floor — PROVEN:** a per-worktree `opencode.json` of the shape `{"mcp":{"flux":{"type":"local","command":["node","…/flux-mcp.mjs"],"environment":{"FLUX_CONTROL_SOCKET":…,"FLUX_SESSION":…},"enabled":true}}}` makes `opencode mcp list` report `✓ flux connected`. opencode spawns the same `flux-mcp.mjs`, completes the MCP handshake, and reads the config from the run's cwd — so §4 works with no adapter-specific tool code.
- **Flags:** `--model provider/model`, `--variant <effort>`, `--auto` confirmed from `opencode run -h`.
- **Role injection — CONFIRMED:** an `AGENTS.md` in the run's cwd is honoured (instruction "end every reply with BANANA" → the agent's reply was "Hi\n\nBANANA"). §5 works; no adapter-specific role code needed.
