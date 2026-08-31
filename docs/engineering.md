# Flux: engineering rules

Status: v1, 2026-08-28. These rules are enforced by tooling wherever possible. Where a rule cannot be enforced by a tool it is stated here and agents are expected to follow it exactly. Changing a rule means changing this file in the same PR.

## Repository layout

```
apps/
  daemon/        Node 24. Runs on the box.
  relay/         Node 24 + Hono. Runs on the VPS. Serves apps/pwa/dist.
  pwa/           Vue 3 + Vite. The remote.
packages/
  protocol/      Wire types, type guards, framing, crypto. Zero runtime deps.
docs/            prd, architecture, protocol, engineering, adr/
e2e/             The one Playwright flow and its stack harness. Root-level, not a package.
AGENTS.md        Entry point for agents. Short. Points here.
CLAUDE.md        Symlink to AGENTS.md.
```

Everything shared between apps lives in `packages/protocol` or does not exist. No `utils` package. If two apps need the same helper and it is not protocol, copy it; three copies is the threshold for a new package and needs an ADR.

## Toolchain

VoidZero stack. Vite+ (`vp`, 0.3.0, beta) is installed as the umbrella and used for `vp run` builds, but the gate calls the individual CLIs directly because `vp check` does not yet honour `.oxfmtrc.json`/`.oxlintrc.json` or run tests (ADR 0001, Status). Every tool under it is stable on its own.

| concern         | tool                                                            | notes                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| package manager | pnpm 11, workspaces                                             | `minimumReleaseAge` left at the default (1 day). Lifecycle scripts blocked except an explicit allow-list in `pnpm-workspace.yaml`.                                                                                                                                                                                                                                                                                        |
| task runner     | `vp` (Vite Task)                                                | `pnpm run check` = fmt check + lint + typecheck + test (`oxfmt --check`, `oxlint`, `tsc`/`vue-tsc --noEmit` per package, `vitest run --coverage`). CI and the pre-commit hook run exactly this. `vp check` 0.3.0 is not used: it skips tests, reads only `vite.config.ts` blocks (not `.oxfmtrc.json`/`.oxlintrc.json`) and typechecks with tsgolint, so per ADR 0001 the individual CLIs run with the checked-in config. |
| bundler         | Vite (pwa), tsdown (daemon, relay; protocol is bundled in)      | Rolldown underneath. Daemon and relay ship as single ESM files.                                                                                                                                                                                                                                                                                                                                                           |
| test            | Vitest                                                          | See Testing.                                                                                                                                                                                                                                                                                                                                                                                                              |
| lint            | Oxlint, type-aware rules on                                     | Config in `.oxlintrc.json`. Categories `correctness`, `suspicious`, `perf`, `pedantic` all `error`. `restriction` selectively. Plugins: `typescript`, `unicorn`, `promise`, `import`, `vue`.                                                                                                                                                                                                                              |
| format          | Oxfmt                                                           | Defaults except single quotes (semicolons, trailing commas `all` and width 100 are the defaults). Formats `.vue` and Markdown natively, so `docs/` is formatted too.                                                                                                                                                                                                                                                      |
| types           | TypeScript 5.9.3, `tsc --noEmit` per package; `vue-tsc` for pwa | Pinned to the 5.x line: `vue-tsc` 3.3 cannot load TypeScript 7 (the Go compiler). Move when it can. See TypeScript.                                                                                                                                                                                                                                                                                                       |
| node version    | 24 LTS                                                          | Pinned in `.node-version` and `engines` (`>=24`, the floor `node:sqlite` needs unflagged). Type stripping is on, so scripts can be `.ts` without a build step. CI also runs `check` and `e2e` on Node 26 (advisory) to prove the deployment range forward.                                                                                                                                                                |
| git hooks       | `core.hooksPath=.githooks`, shell scripts checked in            | No husky, no lefthook. `pnpm install` runs a `prepare` script that sets `hooksPath`.                                                                                                                                                                                                                                                                                                                                      |

## TypeScript

Root `tsconfig.base.json`, extended by each package. Non-negotiable options:

```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "noImplicitOverride": true,
  "noFallthroughCasesInSwitch": true,
  "noPropertyAccessFromIndexSignature": true,
  "verbatimModuleSyntax": true,
  "isolatedModules": true,
  "module": "ESNext",
  "moduleResolution": "bundler",
  "target": "ES2024",
  "erasableSyntaxOnly": true
}
```

`packages/protocol` additionally sets `isolatedDeclarations: true` and `declaration: true`.

Rules:

- No `any`. `unknown` at boundaries, narrowed by a type guard. Oxlint `no-explicit-any` is `error`.
- No `as` casts except `as const` and in test files. Write a guard or fix the types. Oxlint `consistent-type-assertions` set to `never`.
- No `!` non-null assertions. Oxlint `no-non-null-assertion` is `error`.
- No enums, no namespaces, no parameter properties (`erasableSyntaxOnly` enforces these so files run under Node type stripping). No decorators either; `erasableSyntaxOnly` does not catch them, `check-added-lines.sh` does.
- `import type` for types (`verbatimModuleSyntax` enforces this).
- Exported functions have explicit return types (oxlint `explicit-module-boundary-types`).
- Prefer `interface` for object shapes, `type` for unions. Discriminated unions over class hierarchies.
- Errors: throw `Error` subclasses defined in the package; never throw strings or plain objects. RPC boundaries convert to `RpcError`.

## Code style

Formatting is Oxfmt's job; nobody discusses it. Beyond formatting:

- Files: `kebab-case.ts`. One primary export per file, named the same as the file. Vue components `PascalCase.vue`.
- Functions over classes. Classes only for things with real lifecycle (a connection, a session supervisor).
- Arrow functions everywhere: `const parse = (input: string): Result => { … }`. No `function` declarations or expressions, except where a real `this` or generator is required (rare; comment why). Oxlint `func-style` set to `expression` and `prefer-arrow-callback` on.
- No default exports except Vue SFCs, config files and `apps/daemon/src/pi/flux-pi-extension.ts` (pi's extension contract, ADR 0016; carries a `oxlint-disable-next-line` saying so).
- Modules are ESM. No CommonJS anywhere.
- Small files. Aim under 300 lines; over 500 is refused (oxlint `max-lines` and `check-added-lines.sh`).
- Comments explain _why_, never _what_. No commented-out code. No TODO without an issue reference.
- Node built-ins imported with the `node:` prefix.
- Prefer platform APIs: `fetch`, `WebSocket`, WebCrypto, `URL`, `URLPattern`, `structuredClone`, `AbortController`, `node:sqlite`, `node:test` where Vitest is overkill.

### Vue

- `<script setup lang="ts">` only. Composition API only. No Options API, no mixins, no `this`.
- Props via `defineProps<{ … }>()` with types, emits via `defineEmits<{ … }>()`. No runtime prop validation objects.
- Composables in `src/composables/useThing.ts`, one per file, return plain objects of refs and functions.
- State: composables + `reactive`/`ref`. No Pinia unless an ADR justifies it.
- No global CSS beyond `src/styles/base.css`. Scoped styles in components. CSS custom properties for theme.
- Templates stay dumb: no inline logic beyond a ternary. Compute in `<script>`.

## Testing

Vitest everywhere. `pnpm test` runs all packages; `pnpm run check` runs them with coverage.

- Every module in `packages/protocol` has a test file next to it: `thing.ts` / `thing.test.ts`. Coverage target 100% for protocol, enforced, branches included: with `noUncheckedIndexedAccess` a `data[i] ?? 0` is a dead fallback branch the gate will refuse, so index with `DataView`, `charAt` or a bounds-checked loop instead.
- Adapters are tested against **fixtures**: captured real output stored under `apps/daemon/test/fixtures/`. A fixture is added or refreshed whenever the upstream agent changes shape. Fixtures are the contract with the outside world.
- Daemon and relay: unit tests for pure logic, integration tests that run the real thing in-process (real SQLite in a temp dir, real WebSocket on an ephemeral port). No mocking of our own modules. Mock only the process boundary (spawned agents) using fixtures.
- PWA: component tests with `@vue/test-utils` for anything with logic; composables tested directly. No snapshot tests.
- E2E: one Playwright flow (`e2e/flow.test.ts`: pair → create session → send → see reply → comment → send → reload) run against the real relay and daemon from `dist` and the built PWA (service worker included), with the daemon's fixture-replaying fake agent behind `FLUX_CLAUDE` (`e2e/fake-claude.sh`). `pnpm run e2e` builds and runs it; `pnpm exec playwright install chromium` once first. Chromium only. It is its own CI job (`e2e`, required by the ruleset like the other five), not part of `pnpm run check`: it needs a browser and the build, and takes seconds on top of the unit gate. The harness lives at the root (`e2e/`, `playwright.config.ts`), type-checked by the root tsconfig, and imports nothing from the packages. It stays one flow: a new screen gets a step here, not a new spec.
- A bug fix includes a test that fails without the fix.
- Tests are deterministic. No sleeps; await the thing.

## Dependencies

Every npm package is an attack surface and a maintenance cost. The default answer is no.

Process for adding a runtime dependency:

1. Look up the current version with `pnpm view <pkg> version` (never from memory; agents' training data is stale). Check the package's recent release history and open issues while there.
2. Write an ADR entry in `docs/adr/0010-dependencies.md` (running ledger): package, version, what it does, why the platform or 50 lines of our own code cannot, weekly downloads, maintainer, licence, transitive dep count.
3. Pin the exact version. No `^`, no `~`.
4. `pnpm install` must not run any lifecycle script for it unless allow-listed with a reason.

Dev dependencies follow the same process with a lighter bar (tooling churn is expected) but still get a ledger line.

Approved runtime dependencies at v1 (the ledger is authoritative if this drifts):

- `hono` (relay)
- `ws` (relay, daemon: WebSocket server side only; clients use native `WebSocket`)
- `vue`
- `@codemirror/*` (state, view, merge, language packs as needed)

Explicitly rejected, with the reason, so nobody re-proposes them:

- `express`, `fastify`: Hono is smaller and standards-based.
- `zod`, `valibot`, `typebox`: protocol is ~20 shapes; hand-written guards are smaller, faster, and force the protocol to stay small.
- `better-sqlite3`: `node:sqlite` is built in.
- `libsodium`, `tweetnacl`: WebCrypto covers X25519, HKDF, AES-GCM.
- `monaco-editor`: too large and poor on touch. CodeMirror 6.
- `pinia`, `vue-router`: not needed at P1 scale; revisit with an ADR.
- `qrcode` (pwa): scanning uses `BarcodeDetector`. The daemon renders the QR in the terminal; a tiny QR encoder is written in-house or a dev-time-only dependency generates it. Decide when built; ledger it.
- `dotenv`: `node --env-file`.
- `lodash`, `date-fns`, `uuid`: platform has it (`crypto.randomUUID`, `Intl`, `Array.prototype` methods).

## Git

- Branch from `main`. `main` is always green.
- Conventional Commits, enforced by `.githooks/commit-msg` and the `commits` CI job: `<type>(<scope>)?!?: <subject>`. Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`, `build`. Scope, optional: `daemon`, `relay`, `pwa`, `protocol`, `docs`, `repo`. Subject line at most 100 characters. PR titles follow the same rule because PRs are squash-merged.
- Small commits, each passing `pnpm run check`. The pre-commit hook runs it; do not bypass with `--no-verify`.
- PRs (when used) describe _why_. Link the ADR if a decision was made.
- No force pushes to `main`. Squash-merge PRs.

## Security

- Secrets never in the repo, never in logs, never in event payloads. The daemon redacts known secret shapes from `tool.end.output` before logging (API keys, bearer tokens).
- The relay logs no room ids, no IPs beyond rate-limit counters held in memory.
- All randomness from `crypto.getRandomValues` / `crypto.randomBytes`.
- Nonces are counters, never random, and never reused (see `protocol.md`).
- The PWA sets a strict CSP served by the relay: `default-src 'self'; connect-src 'self' wss:; img-src 'self' data: blob:` (`blob:` for attachment thumbnails shown from object URLs).
- GitHub Actions are pinned to full commit SHAs with the tag in a trailing comment; Dependabot proposes bumps for actions only. npm stays on the manual ledger process.
- Dependency updates are reviewed diffs, not blind bumps.

## What the tooling enforces

`pnpm run check` (fmt, lint, types, tests with coverage), `.githooks/pre-commit` (Node 24, exact pins, ledger line for every added dependency, secret shapes, TODO without issue, commented-out code, decorators, `function` keyword, files over 500 lines, lockfile drift, then `check`), `.githooks/commit-msg` (format above), and CI (`check`, `audit`, `hooks` self-tests, `diff` over the PR range, `commits`, and `e2e` for the Playwright flow). `.github/rulesets/main.json` makes those required on `main`; a repo admin applies it with the command in its README. Every rule above not in this list is enforced by review:

- One primary export per file, named the same as the file (the diff check catches the obvious cases only).
- Comments explain why; templates stay dumb; theme colours come from CSS custom properties.
- Ledger rows are honest, not just present.
- A rule change lands in the same PR as the config it describes.
- `--no-verify` locally; CI and the ruleset catch what it skips.

## Definition of done

A change is done when:

1. `pnpm run check` passes locally and in CI.
2. New behaviour has tests; changed behaviour has updated tests.
3. Docs are updated: `protocol.md` for wire changes, `architecture.md` for structural changes, an ADR for any decision, the dependency ledger for any package.
4. The commit message says why.

## Working rules for agents

- Read `AGENTS.md`, then this file, then the relevant `docs/*.md` before touching code. Do not re-derive decisions recorded in `adr/`; if you disagree, write a new ADR that supersedes the old one and stop for review.
- Never add a dependency without following the process above. If you think you need one, stop and ask.
- Never weaken a lint rule or tsconfig option to make something pass. Fix the code.
- Never edit fixtures by hand. Re-capture them.
- Keep changes scoped to the task. Drive-by refactors go in their own commit with their own reason.
- When the protocol changes, `packages/protocol` changes first, then both ends, in one commit.
