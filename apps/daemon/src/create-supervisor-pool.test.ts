import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

import { tempWorktree } from '../test/temp-worktree.ts';
import { createEventLog } from './create-event-log.ts';
import { createGitService } from './create-git-service.ts';
import { createSessionStore } from './create-session-store.ts';
import { createSupervisorPool } from './create-supervisor-pool.ts';
import { openDatabase } from './open-database.ts';

// The pool over a real agent process that will not leave (blocked in an MCP call, as far as
// the daemon can tell): closeAll waits out the stages, killAll cuts that short.

const stubborn = fileURLToPath(new URL('../test/stubborn-agent.ts', import.meta.url));

const setup = async () => {
  const worktree = await tempWorktree();
  const db = openDatabase(':memory:');
  const log = createEventLog({ db });
  const sessions = createSessionStore({ db, lastSeq: log.lastSeq });
  const record = sessions.create({
    session: 's1',
    title: 't',
    repo: worktree,
    worktree,
    branch: 'b',
    base: 'HEAD',
    harness: 'claude',
  });
  const pool = createSupervisorPool({
    log,
    sessions,
    git: createGitService(),
    claudeCommand: stubborn,
    emit: () => {},
    emitEphemeral: () => {},
    // Long enough that only killAll can end the test.
    closeGraceMs: 60_000,
  });
  return { pool, record, sessions };
};

test('killAll reaches a supervisor that closeAll is still waiting on', async () => {
  const { pool, record, sessions } = await setup();
  const supervisor = pool.get(record);
  await supervisor.send('go');
  const closed = pool.closeAll();
  pool.killAll();
  await closed;
  expect(supervisor.state()).toBe('idle');
  expect(sessions.get('s1').state).toBe('idle');
});
