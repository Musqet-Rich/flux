# 0039: The delete refusal names the commits it would lose, on no remote and no kept branch

Status: accepted, 2026-11-10. Amends ADR 0018 § 2's definition of unpushed commits.

## Context

ADR 0018 refuses `sessions.archive` with `removeWorktree` as `dirty` while the worktree holds unpushed commits, counted as `@{upstream}..HEAD`, or `base..HEAD` without an upstream. A bug report on 2026-11-10 showed that rule misfiring. The agent had run `git switch --detach origin/dev` to build from the latest dev; a detached HEAD has no upstream, so the count fell back to the session's base and reported "41 unpushed commits": other people's commits that dev had gained since the session began, every one of them on the remote. The session branch's own commits had been pushed under another branch name and squash-merged. Nothing was at risk, but the warning said otherwise. The rule also judged a branch only against its own upstream, so commits pushed under another branch name still counted as unpushed.

## Decision

1. **A commit is at risk when the delete would leave nothing holding it.** The daemon lists the commits reachable from HEAD, and from the session's branch when the same request deletes it, that no remote-tracking ref holds and no surviving local branch keeps: `git log HEAD [refs/heads/<branch>] --not --remotes [--exclude=<branch>] --branches --`. Where the commits came from, and which branch HEAD is on, no longer matter. A branch the request keeps holds its own commits, so removing the worktree alone flags only commits that HEAD alone reaches. The session's base is not used: for a session opened on an existing branch it is that branch's tip, and excluding it would hide the branch's own local commits.
2. **A squash-merged commit is flagged, but as possibly merged.** Each listed commit that `git cherry` finds patch-equivalent on a remote's default branch (`<remote>/HEAD`, or `<remote>/main` and `<remote>/master` for a remote added without one) or on the upstream of HEAD's branch or the deleted branch is marked `possibly merged`. It is still listed: a patch-id match is evidence, not proof, and a squash of several commits matches none of them, so the operator judges.
3. **The refusal says what is at risk, and lists it.** The `dirty` message is lines of plain text: `The worktree has N uncommitted files.`, then `N commits exist only on this machine` (and how many are possibly merged), then each commit as short sha and subject, up to ten, then `and N more` (with how many of those are possibly merged), then `HEAD is detached.` when it is. The PWA shows it as given, one line per line, then asks "Discard it?".

## Consequences

- No protocol change: `dirty` was always a message for the device to show. A device built before this shows the lines run together and appends its own `. Discard it?` after the final full stop; a daemon built before this sends the old counts, which the new PWA shows as they are.
- A commit pushed under any branch name never blocks a delete. The check reads remote-tracking refs, not the remote: a branch deleted on the remote but not yet pruned locally still counts as holding its commits, and the next `git fetch --prune` drops that evidence. A remote branch deleted after its PR merged and pruned takes the evidence with it too; `git cherry` then catches a one-commit squash or a rebase, and anything else is listed for the operator.
- A few more local `git` calls per delete: two `rev-parse`, a `for-each-ref` for the branches and the log, and, only when something is listed, `git remote` and a `for-each-ref` over the remotes and one `git cherry` per merge target and ref. Deletes are rare.
