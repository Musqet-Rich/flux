#!/bin/sh
# The `claude` the E2E daemon spawns (FLUX_CLAUDE): the daemon's own fixture-replaying fake
# (apps/daemon/test/fake-claude.ts, FLUX_FAKE_FIXTURE) with two additions the flow needs.
# Every line the daemon writes to the agent's stdin is copied to FLUX_E2E_AGENT_STDIN, so the
# test can assert on what the agent was sent; and the file the fixture's Write tool claims to
# create is created for real in the worktree (the cwd), so Changes has a diff to show. The
# daemon's flags are ignored, as the fake ignores them.
set -eu
printf 'hi there\n' > greeting.txt
tee -a "$FLUX_E2E_AGENT_STDIN" | "$FLUX_E2E_NODE" "$FLUX_E2E_FAKE_CLAUDE"
