# 0031: An effort the operator sets in-band sticks: kept on the session, shown at once

Status: accepted, 2026-09-13.

## Context

ADR 0023 § 3 said changing a live session's model or effort is `sessions.restart` with a new spec, and that Flux does not depend on the in-band `/model`. `sessions.restart` never grew the spec: it takes the session alone, and the help text promising otherwise was wrong. So the one way an operator has changed a session's effort from the phone is Claude Code's own `/effort <level>` typed into the composer, which Claude honours for the process it reaches. ADR 0028 then shows the level on the toolbar chip from the transcript, read at each turn's end.

Two things went wrong with that, seen on the box on 2026-09-12. Claude's `/effort` is "this session only" in its own sense, the process's memory: a daemon restart minutes later resumed the session with `--resume` and no `--effort` flag, and the resumed process fell back to `~/.claude/settings.json`, so the operator's medium became high again with no word said. And the chip could not show the level until the end of the next real turn, an hour away under autonomous work: `/effort` is a local command that writes no assistant line, so the read at its own turn's end finds the line before it.

Claude confirms the command on its stream (fixtures/claude/effort-set, 2.1.270, one process fed two turns around four commands with the daemon's own flags): an `init` line, an `assistant` line whose model is `<synthetic>` and whose one text block reads `Set effort level to <level> (this session only): …`, then a `result` with no turns, and no `message_start`, so nothing names `<synthetic>` as a model. `auto` is confirmed in other words, `Effort level set to auto (this session only)`, and an unknown level is refused. `claude --help` lists what `--effort` takes: `low`, `medium`, `high`, `xhigh`, `max`; `/effort` also takes `ultracode` and `auto`, which the flag refuses.

## Decision

1. **The confirmation is the effort, at once.** The parser gives that line its own kind, `effort_set` (`auto`'s wording included), and the adapter takes the level from it as the effort running from here: the spec is logged with it on the spot (with the model on record, so the chip flips within the same second the reply lands; a word given before the first call of a fresh process waits for that call to name the model), no turn end reads the transcript until the model next completes a message of its own (the parser marks a reply made without a call, its model `<synthetic>`), since `/effort` and every other local command (`/status`, `/compact`, `/effort auto`) end a turn without writing an assistant line, as does a call that errors or is stopped before one, and the read would find the old one; the first message after that is the line written, and its turn end reads as ever, by which time the transcript agrees (a probe on 2.1.270 showed the next assistant line carrying the level set). The model's own words are never a level set, whatever they say: only the synthetic line counts.

2. **The level is kept on the session record and asked for at every spawn.** The adapter reports it to the supervisor as `chosen`, the supervisor writes it to the record's `effort` (the configured one of ADR 0023, now the last one the operator asked for) and carries it on every `SpawnRequest`, so a respawn for any cause, daemon restart, Clear, Restart, an agent that exited, passes `--effort <level>`. The spawn compilers read the effort from the request rather than the record, since the record they close over is the snapshot the supervisor was made from, and the new level lands in the store after it. `SessionSummary.effort` follows on the next list.

3. **Only what the flag takes is kept.** `ultracode` and `auto` run in the live process and show on the chip, but the record stays as it was: kept, they would fail the next spawn. The five-word list is from `claude --help`, in the adapter, not a vocabulary check on the wire, which stays free text (ADR 0023 § 3). So after `/effort medium` then `/effort ultracode`, the process runs ultracode and the chip says so, but the next spawn asks for medium, the last word the flag takes.

4. **A Flux-native control comes later.** `sessions.restart` with a model and an effort, and a field on the phone for each, is the uniform way across harnesses, pi and opencode having no `/effort`. It is the next step, not this one; the help text now says what is true today.

## Consequences

- An operator who types `/effort medium` sees `fable-5-1:medium` at once and keeps it through whatever restarts the agent. The trail is in the log as before: the `msg.user` with the command, the `msg.assistant` with Claude's reply, the `agent.spec` row.
- Two more dependencies on Claude Code's output, of the kind ADR 0028 took: the wording of the confirmations and the flag's list of levels. When the wording changes, the line falls back to a plain assistant line and the chip waits for the next turn's end as before; when the flag grows a level, the operator's new word runs but is not kept until the list is updated. Nothing breaks either way.
- `/model` is not covered. A model set in-band shows on the chip at its next call (ADR 0028) and is lost on the next spawn as before; keeping it is the same shape as this decision, done when wanted.
- No protocol change. The store gains `setEffort`; the record's `effort` no longer means only what was typed at create.
