# 0007: Claude Code adapter: read from transcripts, write via swappable input

Status: accepted, 2026-08-28.

## Context

Claude Code offers `claude -p --input-format stream-json --output-format stream-json` for structured headless use, and writes a JSONL transcript of every session to `~/.claude/projects/`. Both were verified on 2.1.251 (see `architecture.md` for the mapping). Risk: Anthropic may restrict headless/SDK use under subscription plans; the boundary has moved before.

## Decision

Split the adapter.

- Read side parses the message objects that appear identically in stream-json stdout and in the transcript JSONL. It therefore works no matter how Claude was launched, including sessions started by hand in a terminal on the box.
- Write side is an `AgentInput` interface with two implementations: `StreamJsonInput` (stdin to a `-p` process, default) and `PtyInput` (drive interactive `claude` in a pseudo-terminal). Selected by config.

## Consequences

- If the headless path is restricted, switch to `PtyInput` with no protocol or UI change. Interactive Claude Code in a PTY on the operator's own box is the plain use of the product.
- `PtyInput` is also the path for agents that only have a TUI, so the fallback doubles as the generalisation for pi and others.
- Fixtures of real stream-json and transcript output are the adapter's contract and must be re-captured when Claude Code changes shape.
