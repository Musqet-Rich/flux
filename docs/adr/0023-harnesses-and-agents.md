# 0023: Harness vs Agent: `claude`/`pi` is the harness; an Agent is a saved Model + Tools + Role preset compiled to per-harness flags

Status: accepted, 2026-08-30.

## Context

The session-create form has a select labelled "Agent" whose options are `claude` and `pi`, and the wire calls that choice `AgentKind`. That is a misnomer. `claude` and `pi` are **harnesses** — the runtime that hosts a model, exposes tools, and talks the stream protocol. What an operator actually wants to pick is closer to

> **Agent = Harness + Model + Tools + Role**

a named, reusable bundle: run _Claude Code_ on _opus_ at _high_ effort, with _these_ tools, told to _be terse and write TypeScript_. Today none of that is reachable except the harness: the model is whatever the box's default is (Claude is spawned with **no `--model` at all**, ADR 0007), effort does not exist in Flux, tools are always the full set, and the only role is Flux's own injected prompt. Changing the model means typing `/model` into the agent and reading its reply — unworkable on a phone.

Both harnesses already expose the knobs as spawn flags (`claude -h`, `pi -h`), and — contrary to an earlier assumption that pi was the thin side — pi maps this abstraction **more** richly than Claude: more providers and models, a thinking superset, finer tool control, and roles that can be whole skill or template files. So the abstraction must be harness-neutral with pi as a first-class citizen, not a Claude model with a pi stub. This ADR names the concepts, fixes the terminology in the contract before release, and sets how an Agent becomes flags. It supersedes nothing; it extends ADR 0007 (Claude adapter), ADR 0016 (pi adapter) and ADR 0015 (settings).

## Decision

1. **"Harness" is the runtime; "Agent" is the preset. Rename the contract accordingly.** `AgentKind` becomes `HarnessKind` (values unchanged: `'claude' | 'pi'`); the `agent` field on `sessions.create` and `session.created` becomes `harness`; `FluxSettings.defaultAgent` becomes `defaultHarness`; the PWA select is relabelled **Harness** with options **Claude Code** and **Pi**. The wire _values_ stay `claude`/`pi` so no data migrates. The `agent.*` RPC and event namespace (`agent.send`, `agent.context`, `agent.answer`, `agent.interrupt`) is **kept** — the running thing genuinely is an agent under this definition; only the `pi`/`claude` selector was mis-named. Mechanical, cross-cutting, one commit, `docs/protocol.md` updated (the hard rule).

2. **An Agent is a saved, named spec, editable in Settings, optional at create.** A spec is `{ harness?, model?, effort?, tools?, role?, ...harness-specific }` — every field optional. Settings gains an `agents` collection (a list of named specs) alongside the existing `flux`/`agent`(now `harnessConfig`)/`env` sections, patched through `settings.set` and edited on a Settings screen. `sessions.create` gains `harness` (required, the runtime), `agent?` (the name of a saved spec), and an inline `overrides?` spec. Choosing no Agent and no overrides is today's behaviour: the bare harness with the box defaults. An Agent **may** pin a `harness`; when it does, selecting it fixes the harness picker, otherwise the Agent runs on whichever harness is chosen and fields that harness cannot honour are dropped (§5).

3. **Effective config is a three-layer merge; session wins.** For a new session the daemon resolves each field as **inline override → named Agent → harness/global default**, then hands the result to the harness compiler. `model` and `effort` are **loose validated strings**, not tight enums: the two harnesses' vocabularies already differ (Claude effort `low..max`; pi thinking `off,minimal,low..max`) and both move every release, so the guard checks "non-empty string", not membership. The resolved `harness`, `model` and `effort` go onto `SessionSummary` so the PWA shows them **from creation**, not only after the first `message_start`. Changing them on a live session is `sessions.restart` with a new spec — uniform across harnesses; Flux does not depend on the in-band `/model`.

4. **The compiler is the architecture: one neutral spec, a per-harness translator to top-level flags.** Each harness adapter turns the resolved spec into that harness's own flags:

   | Spec field      | Claude Code              | pi                                                          |
   | --------------- | ------------------------ | ----------------------------------------------------------- |
   | `model`         | `--model <alias>`        | `--model <pattern>` (+ `--provider`, `:thinking` shorthand) |
   | `effort`        | `--effort <level>`       | `--thinking <level>`                                        |
   | `tools.allow`   | `--tools <names>`        | `--tools`                                                   |
   | `tools.deny`    | `--disallowedTools`      | `--exclude-tools`                                           |
   | `tools.none`    | `--tools ""`             | `--no-tools` / `--no-builtin-tools`                         |
   | `role` (append) | `--append-system-prompt` | `--append-system-prompt`                                    |

   Note (implementation, verified against `claude` 2.1.251): Claude's `--allowedTools` is a _permission_ allow-list, and Flux always spawns with `--dangerously-skip-permissions` (ADR 0007) which makes it inert — it does not restrict which tools exist. Claude's `--tools` (comma-separated, `""` for none) restricts tool _availability_ and is what `tools.allow`/`tools.none` compile to; `tools.deny` uses `--disallowedTools`, which does remove a tool under skip-permissions. MCP tools are unaffected by any of these, which is how the Flux tools floor (§5) survives every mode.

   The spec compiles to these **top-level flags, not Claude's `--agents` JSON**, for two reasons: (a) _composition_ — Flux already injects `--append-system-prompt` and its MCP tools (§5); an `--agents` allowlist that dropped them would silently sever the operator channel, whereas top-level flags layer transparently over the existing injection; (b) _neutrality_ — pi has no `--agents` construct but composes the same agent from primitives, so top-level flags are the surface **both** harnesses expose natively. `--agents`/`--agent` personas and pi's `--skill`/`--prompt-template`/`--extension` roles are a later, richer `role` source, not the foundation.

5. **Flux's tools and prompt are a floor no Agent can remove.** Every spawn, whatever the Agent, keeps Flux's system prompt and Flux's tools available: Claude via `--mcp-config` + Flux tools force-added to any allowlist; pi via the Flux pi-extension (`piExtensionPath()`) kept loaded (never `--no-extensions`) + Flux tools kept out of any denylist. An Agent's `tools.allow` is **unioned** with the Flux tools; its `role` is **appended after** the Flux prompt. A "read-only" Agent restricts the agent's own file/bash tools but can never take away `flux_ask`/`flux_notify`.

6. **Asymmetry is the compiler's job; unsupported fields no-op, they do not error.** The spec is the **union** of both harnesses' capabilities. A field a harness lacks is skipped and, where it matters, surfaced to the operator as an ignored-setting note rather than a failure: **Claude-only** — `--max-budget-usd`, `--prompt-suggestions`, `--permission-mode`, `--agents` personas; **pi-only** — `--provider` and provider breadth, `--skill`/`--prompt-template`/`--extension` roles, `off`/`minimal` thinking, model cycling. Model and effort choices are **suggested, never hardcoded**: the PWA offers known aliases (from `context-window.ts`, and later a daemon-served `--list-models`) as hints over a free-text field, so a model launch never forces a PWA release.

## Consequences

- The schema is designed to the **union** now (so pi's provider, tool granularity and file-roles fit without widening the contract later), while only the **Claude compiler** ships first — "focus on Claude" is a sequencing choice, not a shape choice. pi is first-class in the model and gains its compiler as a fast-follow (ADR 0016's extension already carries the tools floor).
- The rename is contained: `AgentKind → HarnessKind`, `agent → harness` on two payloads, `defaultAgent → defaultHarness`, one PWA label. The `agent.*` surface, the session id, and the stored `claude`/`pi` values are untouched. Doing it pre-release is the cheapest this ever gets; leaving it makes "agent" mean two things in one codebase.
- A session carries a resolved spec, so the toolbar can show harness + model + effort as a chip and the operator reads what is running without a round trip.
- Settings grows a real structured collection (`agents`) beyond the two raw-file blobs of ADR 0015; it lives in the settings store, versioned with the rest, and is Flux-owned config, distinct from the harness's own `settings.json` passthrough.
- Explicitly **out of scope** here, each its own later step: routing `--permission-mode manual`/`dontAsk` approvals to the phone via `flux_ask` (the ambitious version of plan mode); `--agents`/`skill`/`template` as first-class role sources; per-session `--max-budget-usd` and `--fallback-model`. This ADR fixes the concept and the compiler seam so those land as fields, not redesigns.
