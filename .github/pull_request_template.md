## Why

<!-- engineering.md § Git: PRs describe *why*. Link the ADR if a decision was made. -->

## Checklist

- [ ] `corepack pnpm run check` passes locally (the pre-commit hook ran it; no `--no-verify`)
- [ ] New or changed behaviour has tests
- [ ] Docs updated: `protocol.md` (wire), `architecture.md` (structure), an ADR (decision), `adr/0010-dependencies.md` (any package; the `diff` CI job refuses an unledgered add or re-pin)
- [ ] No secrets: the `diff` CI job and the pre-commit hook refuse added lines shaped like keys or tokens; a deliberate fixture carries the marker `secrets-allow`
- [ ] No `TODO`/`FIXME` without a `#123` issue reference, no commented-out code, no source file over 500 lines (the `diff` CI job and the pre-commit hook refuse these on added lines and touched files)
- [ ] `pnpm-lock.yaml` is staged with any `package.json` change (the pre-commit hook refuses drift; CI installs with `--frozen-lockfile`)
- [ ] Commits are Conventional Commits with an allowed scope (the commit-msg hook checked them; the `commits` CI job re-checks every one)

This PR will be squash-merged; the PR title becomes the commit subject and must itself be a valid Conventional Commit. CI runs `.githooks/commit-msg` against the title and the merge is blocked until it passes.
