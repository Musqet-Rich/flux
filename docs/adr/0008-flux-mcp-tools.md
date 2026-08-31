# 0008: Flux-owned MCP tools for ask, notify and compact

Status: accepted, 2026-08-28. Extended 2026-08-30 with `flux_compact` (agent self-compaction). Extended 2026-08-31 with `flux_help` (a bundled manual answered locally; a `flux help` CLI and a seeded Help Agent share the same lookup).

## Context

Verified on Claude Code 2.1.251: in `-p` mode the tool list contains no `AskUserQuestion`, `EnterPlanMode` or `ExitPlanMode`, in both default and `--permission-mode plan`. With permissions bypassed, a headless agent has no built-in way to pause and ask the operator anything. The "agent needs you" notification is a P1 requirement.

## Decision

The daemon ships a stdio MCP server exposing `flux_ask(question, options?)`, `flux_notify(summary, level)` and `flux_compact(focus?)`. It is injected into every session via a per-session `.mcp.json` and `--mcp-config`. The MCP process talks to the daemon over a local Unix socket, sending one control-verb line per call (`ask`, `notify`, `compact`). `flux_ask` blocks the agent until the operator answers or a timeout fires. The daemon passes `--append-system-prompt` alongside `--mcp-config`, telling the agent to use `flux_ask` for material decisions and `flux_notify` when done or blocked, so no per-repo `CLAUDE.md` edit is needed.

`flux_compact` lets the agent compact its own context at a clean boundary between large phases, without the operator. It sends a `compact` control request; the daemon's handler calls `supervisor.send('/compact')` (with `focus` appended when given) — the exact path a hand-typed `/compact` takes — which writes a `{type:'user'}` line to the agent's stdin. Claude queues that user turn and runs it after the current assistant turn ends. The tool therefore returns immediately (it does not wait for compaction) and its schema and description make the contract explicit: **it must be the last action in the turn**, because the queued `/compact` runs as soon as the current assistant turn finishes. Ordering is Claude's input queue, not something the daemon detects or gates on. Unlike `ask`, `compact` parks nothing, logs no event and never touches the ask registry.

### `flux_help`: a bundled manual, three ways in (2026-08-31, wishlist #2)

The operator needs answers about flux itself — how to pair, what an Agent is, how compaction works — from wherever they are, and the agent needs the same reference without carrying the whole manual in context. The knowledge is one **bundled manual**: `apps/daemon/src/help/manual.ts`, a structured array of operator-facing sections `{ title, keywords?, body }` distilled from `docs/`. It is compiled into the binary by tsdown (the `trusted-keys.ts` pattern), because `docs/` does not ship with the daemon; it is never read from disk. A single pure, dependency-free lookup — `apps/daemon/src/help/help-lookup.ts`, `helpLookup(manual, query?)` — is the only reader: no query returns an overview and the topic list; a query ranks sections with a transparent scorer (title match > keyword match > body substring; case-insensitive, prefix-aware) and returns the best few as plain text. No fuzzy-search dependency.

Three surfaces share that one lookup:

- **`flux_help(query?)` — a floor MCP tool.** Unlike `flux_ask`/`flux_notify`/`flux_compact` it does **not** go over the control socket; it answers **locally** by calling `helpLookup` and returning the text, so it is instant and needs no daemon round-trip. It joins the Flux-tools floor: `isFluxTool` (compile-claude-tools.ts) names it, so no tool mode (`allow`/`deny`/`none`) can strip it — every agent, however locked down, can look flux up.
- **`flux help [term]` — a CLI subcommand.** Dispatched in `index.ts` before `createDaemon`, like `flux pair`/`flux update --check`: pure bundled text, no relay URL, no daemon, no socket. `process.argv.slice(3)` joined is the term; empty prints the overview.
- **A seeded default "Help" Agent.** On first daemon start the settings store seeds one read-only Agent named `Help` (`harness: claude`, a short role telling it to answer from `flux_help`, `tools: { mode: 'deny', list: [Bash, Edit, Write] }`). The seeding is guarded by a marker row: it runs once, never clobbers an operator's own `Help`, and never resurrects a deleted one. The Agent keeps the floor (so `flux_help` and the operator channel remain) but cannot change the box.

## Consequences

- The `ask` event schema is owned by Flux and identical across agents and agent versions.
- Works for pi and any future MCP-capable agent with no adapter work.
- The agent's own interactive tools, if they ever return in headless mode, are ignored in favour of these.
- `flux_compact` reuses the operator's own `/compact` path, so self-compaction behaves identically to a hand-typed one; the only new surface is the tool and the `compact` control verb, both on the floor no Agent can strip.
- `flux_help` adds no wire message and no control verb: the manual, the lookup, the tool, the CLI and the seeded Agent are all local. The manual is bundled, so it ships and versions with the daemon and cannot drift from a disk copy; keeping it lean (a few KB) keeps the binary small. One lookup means the CLI, the tool and the Help Agent can never disagree.
