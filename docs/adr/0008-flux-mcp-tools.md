# 0008: Flux-owned MCP tools for ask, notify and compact

Status: accepted, 2026-08-28. Extended 2026-08-30 with `flux_compact` (agent self-compaction).

## Context

Verified on Claude Code 2.1.251: in `-p` mode the tool list contains no `AskUserQuestion`, `EnterPlanMode` or `ExitPlanMode`, in both default and `--permission-mode plan`. With permissions bypassed, a headless agent has no built-in way to pause and ask the operator anything. The "agent needs you" notification is a P1 requirement.

## Decision

The daemon ships a stdio MCP server exposing `flux_ask(question, options?)`, `flux_notify(summary, level)` and `flux_compact(focus?)`. It is injected into every session via a per-session `.mcp.json` and `--mcp-config`. The MCP process talks to the daemon over a local Unix socket, sending one control-verb line per call (`ask`, `notify`, `compact`). `flux_ask` blocks the agent until the operator answers or a timeout fires. The daemon passes `--append-system-prompt` alongside `--mcp-config`, telling the agent to use `flux_ask` for material decisions and `flux_notify` when done or blocked, so no per-repo `CLAUDE.md` edit is needed.

`flux_compact` lets the agent compact its own context at a clean boundary between large phases, without the operator. It sends a `compact` control request; the daemon's handler calls `supervisor.send('/compact')` (with `focus` appended when given) — the exact path a hand-typed `/compact` takes — which writes a `{type:'user'}` line to the agent's stdin. Claude queues that user turn and runs it after the current assistant turn ends. The tool therefore returns immediately (it does not wait for compaction) and its schema and description make the contract explicit: **it must be the last action in the turn**, because the queued `/compact` runs as soon as the current assistant turn finishes. Ordering is Claude's input queue, not something the daemon detects or gates on. Unlike `ask`, `compact` parks nothing, logs no event and never touches the ask registry.

## Consequences

- The `ask` event schema is owned by Flux and identical across agents and agent versions.
- Works for pi and any future MCP-capable agent with no adapter work.
- The agent's own interactive tools, if they ever return in headless mode, are ignored in favour of these.
- `flux_compact` reuses the operator's own `/compact` path, so self-compaction behaves identically to a hand-typed one; the only new surface is the tool and the `compact` control verb, both on the floor no Agent can strip.
