# 0008: Flux-owned MCP tools for ask and notify

Status: accepted, 2026-08-28.

## Context

Verified on Claude Code 2.1.251: in `-p` mode the tool list contains no `AskUserQuestion`, `EnterPlanMode` or `ExitPlanMode`, in both default and `--permission-mode plan`. With permissions bypassed, a headless agent has no built-in way to pause and ask the operator anything. The "agent needs you" notification is a P1 requirement.

## Decision

The daemon ships a stdio MCP server exposing `flux_ask(question, options?)` and `flux_notify(summary, level)`. It is injected into every session via a per-session `.mcp.json` and `--mcp-config`. The MCP process talks to the daemon over a local Unix socket. `flux_ask` blocks the agent until the operator answers or a timeout fires. Box-side `CLAUDE.md` tells the agent to use `flux_ask` for material decisions.

## Consequences

- The `ask` event schema is owned by Flux and identical across agents and agent versions.
- Works for pi and any future MCP-capable agent with no adapter work.
- The agent's own interactive tools, if they ever return in headless mode, are ignored in favour of these.
