# 0017: Daemon lifecycle: bounded shutdown, one daemon per data dir, orphans settled on start

Status: accepted, 2026-08-29.

## Context

Dogfooding on 2026-08-29: the operator restarted the stack with `kill <daemon pid>` and started a new daemon on the same `FLUX_DATA_DIR`. The old daemon never exited, so two daemons ran against one SQLite file. The old one held a `claude` blocked inside `flux_ask`, with the ask parked in its in-memory registry; the operator's answer went to the new daemon (`no such ask`); the next message spawned a second `claude` for the same session with `--resume`; four agent processes were stranded under the old daemon.

Why the old daemon hung:

- `stop()` closed each agent by ending its stdin and waiting for exit. An agent blocked in an MCP call (a `flux_ask` the daemon itself was holding) never reads EOF, so the wait was unbounded and SIGTERM was a no-op.
- The control socket's `close()` was `server.close`, which waits for open connections; the MCP server's connection was one of them.
- Nothing stopped a second daemon from binding the same directory: `listen` unlinked any existing `control.sock` unconditionally.

## Decision

1. **Bounded shutdown.** `daemon.stop()` runs in this order: transport off; every pending ask settled `aborted` (logged and broadcast as `ask.answered`, the in-flight `flux_ask` gets that reply); control server closed _and its open connections destroyed_; each agent closed by `close-child.ts`, three stages of `graceMs` (1.5 s by default) each: stdin EOF, SIGTERM, SIGKILL of the agent's process group (agents are spawned as group leaders so the MCP server or pi extension dies with them). A session caught `running` or `waiting_user` by a close is logged `idle` with the reason, so the log is truthful and the next message resumes it. Between settling the asks and destroying the connections, `stop()` yields one turn of the event loop so each control handler logs its `ask.answered` and writes the `aborted` reply: an agent blocked in `flux_ask` gets a tool result, and a well-behaved one then leaves on stdin EOF instead of needing SIGKILL. Each close stage goes to stderr with the session id. `index.ts` exits with 1 if `stop()` rejects; on a second signal, or when a 10 s budget passes, it calls `daemon.abandon()` (SIGKILL of every agent's process group and the lock released, synchronously) and exits at once, so a shutdown that could not wait still strands no agent.
2. **One daemon per data dir.** `flux daemon` writes `<dataDir>/daemon.lock` with its pid, create-exclusive, before it touches `control.sock`. If the file exists and its pid is alive, the daemon refuses with exit code 3 and `another flux daemon (pid N) holds <path>`; a stale file (dead pid, or not a pid) is replaced: it is renamed aside first, so of two daemons that both found it stale only one rename succeeds and neither can unlink the lock the other has just created. The lock is removed on a clean stop, on `abandon`, and when `start` fails after taking it. `flux pair` and `flux devices` take no lock: they are short-lived and, for `devices rm`, talk to the running daemon.
3. **Orphans settled on start**, after the lock and before the relay: for every session whose stored state is `running` or `waiting_user`, any `ask` without an `ask.answered` is answered `{ by: 'aborted' }`, and the session is set `idle` with a `session.state` carrying `reason: 'daemon restarted'`. These are ordinary appends, so `events.sync` delivers them to a device on its next connect. Sessions in `idle` or `ended` cannot hold either kind of orphan and are not read.

## Consequences

- No protocol change: `ask.answered` already has `by: 'aborted'`, `session.state` already carries a reason.
- `deploy/flux-daemon.service` keeps `TimeoutStopSec=60` and `KillMode=mixed`: the daemon's own budget is 10 s, so systemd's SIGKILL only ever reaches something already past the daemon's escalation.
- An agent that cannot be reached by EOF or SIGTERM is SIGKILLed; whatever it was writing at that moment is its problem, as it would be on a box reboot. Both agents resume from their own session files on the next message.
- Exit code 3 is deliberate and, like 2, must not be restarted into: the unit's `RestartPreventExitStatus` lists it.
