# 0025: Manager Agent — an opt-in, audited fleet-control surface for agents

Status: accepted, 2026-08-30.

## Context

Flux runs many sessions; today only the operator, through the PWA over the wire RPC, can list, open, message, archive or read them. The product wants a **manager agent**: an agent that supervises other agents — opening sessions for sub-tasks, checking on them, messaging them, winding them down. That means handing an agent a slice of the operator's own control surface, which is a trust decision, not merely a feature. This ADR fixes what that surface is and the guardrails around it. It extends ADR 0008 (the Flux MCP tools and control socket) and ADR 0023 (the Agent spec); it does not change the device↔daemon wire protocol except for one new log event.

## Decision

1. **A manager is an opt-in Agent capability, never part of the tools floor.** ADR 0008's floor (`flux_ask`/`flux_notify`/`flux_compact`) is on for every agent. The manager tools are the opposite: off for every agent, attached only when an Agent's saved spec sets `manager: true`. They ride a **separate MCP server, `flux-manager`**, added to the session's `.mcp.json` only for a manager session — so they cannot leak into an ordinary agent through the tools union, a `tools.allow` list, or any other path. `AgentSpec` gains `manager?: boolean`; the resolved value is persisted on the session record at create (a nullable column, the ADR-0023 pattern) so restart re-spawns identically and the authorisation check in §5 is stable even if the Agent is later edited.

2. **The surface is list / open / send / close / read — the operator's non-destructive session verbs.** Five agent-facing tools on the `flux-manager` server, each fronting the internal operation the RPC handlers already use:
   - `flux_sessions_list` → the fleet: each session's id, title, harness, state, repo/branch. (sessions.list)
   - `flux_session_open` → create a session (repo, branch, harness, optional saved-agent name / model / effort / base / title). (sessions.create)
   - `flux_session_send` → send a prompt to another session's agent. (agent.send)
   - `flux_session_close` → archive a session. (sessions.archive)
   - `flux_session_read` → a bounded text digest of a target session's recent activity (last N events/messages), enough to supervise without streaming its whole history. (reads the event log)

3. **No destructive power.** A manager may archive (reversible) but never permanently delete a session, its worktree, or its history — deletion stays operator-only, consistent with Flux's global safety posture. `sessions.clear`, `sessions.restart`, `sessions.rename` and device revocation are **not** exposed to managers in this ADR.

4. **Every manager action is audited to the operator.** Each successful mutating verb appends a `manager.acted` event (a new FluxEvent: actor session, action, target session, one-line detail) to the **target** session's log, which the operator sees in that session's timeline; the manager's own tool result records what it did. There are no silent fleet changes: the operator can always reconstruct what the manager did and to which sessions.

5. **The daemon authorises every manager verb against the caller's persisted capability.** The control socket is local, but defence-in-depth: on each `manager.*` control request the handler looks up the **caller** session (its `FLUX_SESSION`) and refuses unless that session's persisted `manager` flag is true. A non-manager session has no manager MCP server and thus no tool, and even a hand-crafted control frame is rejected. The mutating verbs also reject a missing / unknown / archived target with a clean error, and reject the caller targeting **itself**.

6. **A manager cannot create another manager.** `flux_session_open` refuses to launch a session whose named Agent has `manager: true`. This removes self-replication and runaway fanout at the root rather than policing it with depth counters; genuine manager hierarchies, if ever wanted, are a later ADR with their own controls. The operator can still create any number of managers directly.

## Consequences

- The manager is a pure composition over surfaces that already exist (the session-lifecycle ops and the event log); it adds an alternate, tightly-scoped caller — an agent — to them, not new lifecycle logic.
- The opt-in-plus-separate-server design means the blast radius of an ordinary compromised or confused agent is unchanged: it still cannot see or touch another session. Only an Agent the operator deliberately marked `manager` gets the surface, and only within the non-destructive, audited verbs above.
- `AgentSpec` grows one boolean; the session record grows one column; the PWA Agents editor grows one toggle. The wire protocol is unchanged except for the new `manager.acted` log event, surfaced like any other event.
- Explicitly out of scope, each a later step: destructive verbs for managers, manager hierarchies/delegation, cross-repo policy, and per-manager quotas. This ADR fixes the safe core so those land as extensions, not redesigns.
