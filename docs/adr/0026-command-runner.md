# 0026: Command runner — operator-only, ephemeral one-off command execution

Status: accepted, 2026-08-31.

## Context

Operators sometimes need to run a one-off command on the box that isn't agent work — `openssl rand -base64 32`, restart a service, `git status`, `df -h`, run a test. Today the only ways are to SSH in or to make an agent do it. We want a first-class "run a command, see the output" affordance reachable from the phone. This ADR fixes its shape. It deliberately is **not** an interactive terminal (no PTY, no persistent shell state); that heavier thing is out of scope and would be a later ADR. It extends ADR 0008 (control/tools boundary) and reuses the ephemeral-event mechanism (ADR 0022, `update.progress`).

## Decision

1. **Operator-only; never an agent tool.** The runner is a wire RPC surface reachable only by a paired device over the E2E channel. No `flux_*` MCP tool exposes it and no agent can invoke it — the trust boundary is pairing, identical to the rest of the operator surface. (A paired device already commands arbitrary execution on the box via agents spawned with `--dangerously-skip-permissions`, so this grants no new ceiling — only a more direct path.)

2. **One-off and non-interactive, via `node:child_process.spawn` — no PTY, zero new dependencies.** Each run is an independent child process; there is **no persistent shell, cwd, or environment carried between commands** (that would be the interactive PTY, explicitly out of scope). The command string is executed through a shell (`sh -c <command>`) so pipes, `&&`, redirection and globs work within a single command. node-pty is deliberately not used; tty-fidelity (native colour) is approximated with `FORCE_COLOR=1` in the child env and a hand-rolled ANSI-SGR→markup pass on the client (no dependency, mirroring the hand-written markdown renderer).

3. **Output is streamed as sessionless ephemeral events and is not persisted.** `shell.run { command, cwd? }` starts the process and returns a `runId`; `shell.output { runId, stream, chunk }` events carry stdout/stderr as they arrive; `shell.exited { runId, code, signal, truncated }` ends it. These are ephemerals (`packages/protocol/src/ephemeral.ts`), broadcast like `update.progress` — **nothing is written to the event log or the database.** Shells are ephemeral by design; scrollback lives in the client while the runner view is open. On reconnect, in-flight output may be missed — acceptable.

4. **Bounded, so a runaway command cannot flood the device or the box.** Total captured output per run is capped (256 KiB); the run has a max wall-clock (10 minutes). Hitting either truncates or kills the process and sets `truncated` (with a reason) on `shell.exited`. Output chunks are coalesced before broadcast.

5. **The exec context is deliberate and least-privilege-leaning.** The child runs as the daemon's user with `cwd` defaulting to the repos dir; an optional `cwd` is validated to be **inside the repos dir** (the ADR-0018 `inside` guard) — arbitrary paths are refused. The daemon's own secret environment (every `FLUX_*` variable and anything granting signing/keychain access) is **scrubbed from the child env** so a command cannot trivially read Flux's secrets. (A command can still read the data dir on disk; a single-operator trusted box accepts this, and it is documented, not hidden.)

6. **Interrupt and lifecycle.** `shell.interrupt { runId }` escalates SIGINT→SIGTERM→SIGKILL within a bounded budget (ADR 0017). At most one run is active per device at a time; a `shell.run` while one is active is refused (`conflict`). A run is killed if its device disconnects — no orphaned processes.

7. **UI: a distinct entry point, not a session tab.** The runner opens from its own top-bar button beside Settings and Help, into a dedicated view — kept out of the agent tab strip so it is visually and conceptually separate from agents. The view renders the command + streamed output (ANSI-coloured), a Stop control while running, and a one-tap **Copy** on each run's output.

## Consequences

- Reuses the existing E2E transport and the sessionless-ephemeral pattern; **no session-store change, no new transport, no persistence.** A modest, contained feature.
- The security cost over the status quo is small (pairing is already the boundary; agents already run unsandboxed); the new, deliberate mitigations are secret-env scrubbing and the cwd guard.
- Explicitly out of scope, each a later ADR if wanted: an **interactive PTY** (node-pty) with persistent cwd/tty fidelity and a full mobile key-bar; **worktree-scoped** shells tied to a session; **persisted command history / audit**. This ADR fixes the safe, cheap core so those land as extensions.
