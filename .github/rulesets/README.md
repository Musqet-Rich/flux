# Repository rulesets

Branch protection for `main` (engineering.md § Git: `main` is always green, no force pushes, squash-merge PRs) cannot be enforced by anything inside the repository. It lives in GitHub repository rulesets, configured outside the tree. `main.json` is the source of truth for that configuration, kept here so it is reviewed like code.

What `main.json` enforces on the default branch:

- no deletion, no force push (`non_fast_forward`)
- changes arrive by pull request, squash merge only, review threads resolved
- all six `ci` jobs must pass on the PR head before merge (`strict` means the branch must be up to date with `main`): `check`, `audit`, `hooks`, `diff`, `commits` and `e2e` (the Playwright flow, docs/engineering.md § Testing). The `diff` job runs `.github/scripts/check-dep-ledger.sh`, `.github/scripts/check-secrets.sh` and `.github/scripts/check-added-lines.sh` over the PR range: it fails if any package.json dependency was added or re-pinned without a backticked line in `docs/adr/0010-dependencies.md` (engineering.md § Dependencies step 2), if any added line has the shape of a secret (engineering.md § Security; a deliberate fixture carries the marker `secrets-allow`), or if an added line is a `TODO`/`FIXME`/`XXX` without a `#123` issue reference or commented-out code, or a touched source file is over 500 lines (engineering.md § Code style; a deliberate exception carries the marker `rules-allow`). The pre-commit hook runs all three scripts on the staged index. The `commits` job runs `.githooks/commit-msg` over the PR title (which becomes the squash commit on `main`) and every commit in the PR, so Conventional Commits are enforced server-side, not only by the local hook. For a same-repository PR, `check`, `audit`, `hooks` and `e2e` come from the push run on the same head SHA and the pull_request run skips them; GitHub counts a skipped required check as satisfied, so the contexts still gate the merge.

Apply or update it (GitHub CLI, repo admin):

```sh
# first time
gh api -X POST repos/{owner}/{repo}/rulesets --input .github/rulesets/main.json
# later: find the id, then update
gh api repos/{owner}/{repo}/rulesets --jq '.[] | select(.name=="main") | .id'
gh api -X PUT repos/{owner}/{repo}/rulesets/<id> --input .github/rulesets/main.json
```

The same JSON imports through Settings, Rules, Rulesets, "Import a ruleset". If a job in `ci.yml` is renamed, update the `context` strings here in the same commit.
