# 0014: Git actions from the PWA spawn `git` and `gh`, emit no events

Status: accepted, 2026-08-29. Adds `git.commit`, `git.push`, `git.pr` and the `gh_error` code to `protocol.md` § 7.

## Context

PRD P2 story 4: commit, push and open a pull request from the phone. The daemon already drives git by spawning it (architecture.md § Daemon). Opening a PR needs the forge's API; `gh` is already how the operator does it on the box, holds the login, and knows the remote.

## Decision

- Three RPCs, each running in the session's worktree: `git.commit` (stage the given paths, or everything including untracked files, then commit), `git.push` (never `--force`; `--set-upstream <remote> <branch>` on a branch's first push, or when asked), `git.pr` (`gh pr view --json url,state` first, so an open PR is returned rather than duplicated, while a closed or merged one is ignored and a new one created; then `gh pr create --title … --body …`). A commit of chosen paths uses `git commit --only -- <paths>` so whatever the agent had staged elsewhere stays staged.
- Both tools run through one runner (`run-command.ts`): an argument vector, never a shell string; user input only ever appears as an argument after `--` or as the value of an option; a 120 s timeout that kills the command's whole process group (hooks included); paths are checked against the worktree with `inside`. The environment drops only the repository-selecting `GIT_*` variables (a hook exports them), keeps the rest (`GIT_SSH_COMMAND`), and disables terminal prompts for both tools.
- A new error code `gh_error` rather than reusing `git_error`, so the PWA can tell "git refused" from "gh is not there or not logged in". Both carry the tool's stderr (or stdout when stderr is empty) as the message.
- No `git.committed` / `git.pushed` events. These actions are the operator's, not the agent's; the log records the agent's work. The PWA refreshes `git.status` and `git.log` after each action. An event type can be added later without a version bump (§ 8). Amended 2026-08-29: `git.pr` is the one exception and logs `pr.published`, the same event the Claude adapter logs when the agent opens a PR itself, so the PWA has one source for a session's PR whichever side opened it (`protocol.md` § 5).

## Consequences

- The box needs `gh` on PATH, logged in as the daemon's user, for Open PR only; commit and push work without it.
- Tests mock `gh` at the process boundary: a script placed first on PATH that logs its arguments. The git service takes an `env` so tests can point PATH and HOME at temp directories.
- Nothing forces, rebases or switches branches. Anything beyond commit, push and PR is done on the box.
