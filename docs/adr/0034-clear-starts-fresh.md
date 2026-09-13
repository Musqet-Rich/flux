# 0034: A typed `/clear` is Flux's clear, and the timeline opens at the Context cleared marker

Status: accepted, 2026-09-13. Amends 0018 § 1 and 0025 § 3.

## Context

ADR 0018 made `sessions.clear` the `/clear` of a terminal session, reached from the session menu as Clear context, and had the timeline show its marker as a rule reading "Context cleared" with the whole history still above it. Dogfooding on 2026-09-13 found two things wrong with that in practice.

Out of habit the operator types `/clear` in the composer, as they would at a terminal. Flux passed it to the agent as a message. On Claude Code that runs the agent's own `/clear`: the context goes and the operator sees it working, but the box knows nothing. No marker is logged, and the session row still holds the agent-native session id, so the next respawn (a restart, a daemon restart) resumes the conversation the operator thought was gone. pi and opencode have no such command; there the line is a message like any other.

And a clear that leaves the whole conversation on screen does not feel like one. The operator clears to start over; the screen should start over with them.

## Decision

1. **A bare `/clear` sent through `agent.send` is `sessions.clear`.** The daemon's handler checks the text, whitespace trimmed, before anything is logged: `/clear` alone is the clear, answered with the `session.cleared` marker's seq in place of a message's, so a device's send flow needs no special case. `/clear this up`, `/cleared` and `/Clear` are messages, as `/compact <focus>` is a message with an argument. The pending comments a device names on every send stay pending, unmarked: they are about the code and go with the next message, as 0018 decided. A `/clear` with a reply or attachments is `bad_params`: there is no message for them to ride on, and marking them sent would lose them. A manager's `session.send` (ADR 0025) takes the word the same way, through the shared clear op, since the failure is the harness's and the text's, not the sender's. That amends 0025 § 3, which kept `sessions.clear` from managers: a clear drops nothing the log keeps, so it sits inside the no-destructive-power rule as an archive does.

2. **The timeline opens at the last marker.** The window over main's rows (architecture.md § PWA, `useSessionTimeline`) never on its own reaches above the last `session.cleared`: a trim puts its top edge at the later of that marker and the last 300 rows, and a marker arriving moves the edge down to it, whether the operator is at the tail or reading history, since they asked for a fresh start. The Context cleared rule is the first row, with Show earlier above it. Show earlier and a reply chip's reveal reach past the marker like any other row, and the next trim at the tail cuts back to it. A subagent's chat has no markers, and nothing changes there.

3. **The log stays intact.** The box keeps everything, as 0018 decided: Changes, pending comments, the agents strip and the audit trail are untouched, and nothing changes on the wire but the meaning of one text.

## Consequences

- The habit works, on every harness and from a manager, and Flux owns the result: the marker is logged, the agent-native id forgotten, and no later respawn brings the old context back.
- A message that happens to be exactly `/clear` cannot be sent to the agent. Nothing was lost: on Claude Code it was the agent's clear, on the others a line the agent could do nothing with.
- The session's history is a tap away rather than on screen. `Show N earlier` above the rule says how much there is.
- A clear landing while the operator is scrolled up in history takes them to the marker at once, with no "new" pill for it: they asked for the fresh start.
- Not a protocol version change: `agent.send` takes what it took and answers what it answered. An older daemon given `/clear` by a newer device still passes it to the agent, as before; an older device sending `/clear` to a newer daemon gets the clear, which is what its operator meant.
