# 0035: Node 24 is the floor, not the only version

Status: accepted, 2026-10-31. Widens the version in 0002; the runtime choice (Node, not Bun or Deno) stands.

## Context

0002 chose Node 24 and the pre-commit hook enforced it exactly: any other major was refused. `engines` already says `>=24`, the floor `node:sqlite` needs unflagged, and CI already runs `check` and `e2e` on Node 26 to prove the range forward. Node 26 is now the current LTS, and a developer whose machine runs it could build and test Flux but could not commit.

Node 25 and later no longer bundle corepack, which every documented pnpm command goes through.

## Decision

The hook accepts Node 24 or later. `.node-version` stays at 24, so CI's required jobs and the release build keep running on the floor. On Node 25 and later, corepack is installed once with `npm install -g corepack`; the hook's message says so.

## Consequences

- Local `check` can run on a newer Node than the required CI jobs. A change that only works on the newer Node is caught by the required jobs on 24, not locally.
- Revisit the floor when Node 24 leaves maintenance, by moving `.node-version`, `engines` and the CI matrix together.
