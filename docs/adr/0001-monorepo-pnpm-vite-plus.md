# 0001: Monorepo with pnpm workspaces and Vite+

Status: accepted, 2026-08-28.

## Context

Three deployables (daemon, relay, pwa) share one protocol package and must evolve in lockstep. Future clients (desktop shell, native mobile) are likely. The operator wants the VoidZero toolchain and a single command that runs every check.

## Decision

One repository. pnpm 11 workspaces with `apps/*` and `packages/*`. Vite+ (`vp`) as the task runner and umbrella over Vite, Vitest, Oxlint, Oxfmt and tsdown. No Turborepo or Nx; `vp` and pnpm's workspace filtering are enough at this scale.

## Consequences

- Protocol changes land in one commit across all consumers.
- Vite+ is beta. If it breaks, each tool is invoked directly with the same config files; nothing in the repo depends on `vp` semantics beyond `package.json` scripts.
- pnpm's `minimumReleaseAge` default (1 day) and blocked lifecycle scripts are part of the supply-chain posture; see `engineering.md`.

## Status, 2026-08-29

vite-plus 0.3.0 is installed and `vp run` drives package builds. `pnpm run check` calls `oxfmt`, `oxlint`, `tsc`/`vue-tsc` and `vitest` directly because `vp check` at this version reads only `vite.config.ts` blocks (not the rc files), typechecks with tsgolint instead of `tsc`/`vue-tsc`, and does not run tests. Revisit when it honours rc files; the config files need no change either way.
