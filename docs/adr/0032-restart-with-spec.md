# 0032: Model and effort set from the phone: `sessions.restart` takes them, the agent respawns with them

Status: accepted, 2026-09-13.

## Context

ADR 0023 § 3 promised that changing a live session's model or effort is `sessions.restart` with a new spec. ADR 0031 found the call took the session alone, and that nothing on the phone called it at all: the manual and the architecture table said the operator could restart from the PWA, and could not. The only mid-flight control was Claude Code's `/effort <level>`, which ADR 0031 made stick; pi and opencode have no such command, and no harness has a way to change the model from the phone.

A probe on Claude Code 2.1.270 showed `--resume <id> --model sonnet --effort low` honoured on a resumed session: the conversation carries on under the new flags. pi takes `--model`/`--thinking` against the same session file, and opencode's `--model`/`--variant` are per run (ADR 0027), so all three respawn with a changed spec.

## Decision

1. **`sessions.restart` takes `model` and `effort`.** Each is a string to set, `null` to clear back to the box's default, or absent to keep; both absent is the plain restart it always was. The values are the same loose free-text as `sessions.create` (ADR 0023 § 3): the wire checks non-empty, not membership, and what is typed is what the harness flag gets. Values are trimmed and a blank one is `bad_params`, since a blank flag would end the session it was meant to change. The box settles the agent's open asks as aborted and closes it, as Clear does; it writes the row before the close, so a send not queued behind the restart (a manager's, over the control socket) already spawns the new spec, and again after it, since a closing Claude may still confirm an in-band effort (ADR 0031) that would otherwise land over the one just asked for. Nothing respawns on its own: the next `agent.send` spawns from the fresh row, resuming the agent's context, and the help text says so.

2. **One sheet on the phone.** "Model & effort…" in the session menu opens a sheet with the two inputs, each starting as the session's summary has it, with the create form's hints. Submit sends only what changed (an emptied input as `null`) and is labelled Restart, so the sheet is also the missing Restart verb. The list is refreshed after, since the summary's `model` and `effort` are the box's.

3. **The chip follows the agent, not the request.** The toolbar's `model:effort` (ADR 0028) changes when the new process first names its model and, for Claude, when its first turn ends and the transcript is read. A restart logs no `agent.spec` of its own: nothing has confirmed the flags yet, and the model as typed (`sonnet`) is not the model as run (`claude-sonnet-5`). The summary carries the request meanwhile.

## Consequences

- The uniform control ADR 0031 § 4 deferred, for every harness. Its help text is replaced with what is now true.
- A level the `--effort` flag refuses (`ultracode`, `auto`) typed on the sheet fails the next spawn, as it would at create. The hints are Claude's words; pi and opencode have their own (ADR 0027 § 5), and the sheet, unlike the create form, has no harness picker beside it to say which apply.
- No event is logged: the configured pair is row state, carried on the summary, and the trail of what runs is the agent's own `agent.spec` at its next call. Another device sees the new pair on its next `sessions.list` (a reconnect), as it does a configured pair from create; the sheet on that device starts from the old one until then.
- Restart now settles the agent's open asks as aborted before closing it, as Clear and Archive do; before, a restart mid-ask left the ask pending.
- Protocol change: one method's params widen, the result and everything else stay. An older PWA sends the session alone, which still means a plain restart.
