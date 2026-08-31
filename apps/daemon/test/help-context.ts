import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEventLog } from '../src/create-event-log.ts';
import { createGitService } from '../src/create-git-service.ts';
import { createSessionStore } from '../src/create-session-store.ts';
import { createSupervisorPool } from '../src/create-supervisor-pool.ts';
import type { HandlerContext } from '../src/handler-context.ts';
import { openDatabase } from '../src/open-database.ts';

// A minimal real HandlerContext for the Help path (create-session.ts `createHelp`): a real event
// log, session store, git service and supervisor pool over the fixture-replaying fake agent. No
// saved Agents are seeded, so a Help session's role/tools must come from the inline help spec.

export interface HelpContext {
  ctx: HandlerContext;
  dataDir: string;
  reposDir: string;
  sessions: ReturnType<typeof createSessionStore>;
  log: ReturnType<typeof createEventLog>;
  emitted: { type: string }[];
  cleanup: () => Promise<void>;
}

const fake = fileURLToPath(new URL('./fake-claude.ts', import.meta.url));
const fixture = fileURLToPath(
  new URL('./fixtures/claude/session-two-turns.jsonl', import.meta.url),
);

export const helpContext = async (): Promise<HelpContext> => {
  process.env['FLUX_FAKE_FIXTURE'] = fixture;
  const root = await mkdtemp(join(tmpdir(), 'flux-help-'));
  const dataDir = join(root, 'data');
  const reposDir = join(root, 'repos');
  const worktreesDir = join(dataDir, 'worktrees');
  await mkdir(worktreesDir, { recursive: true });
  await mkdir(reposDir, { recursive: true });
  const db = openDatabase(':memory:');
  const log = createEventLog({ db });
  const sessions = createSessionStore({ db, lastSeq: log.lastSeq });
  const git = createGitService();
  const emitted: { type: string }[] = [];
  const pool = createSupervisorPool({
    log,
    sessions,
    git,
    claudeCommand: fake,
    emit: (event) => {
      emitted.push(event);
    },
    emitEphemeral: () => {},
    closeGraceMs: 100,
  });
  const ctx = {
    env: { dataDir },
    agents: ['claude'],
    worktreesDir,
    git,
    sessions,
    log,
    supervisor: pool.get,
  } as unknown as HandlerContext;
  const cleanup = async (): Promise<void> => {
    await pool.closeAll();
    db.close();
    await rm(root, { recursive: true, force: true });
  };
  return { ctx, dataDir, reposDir, sessions, log, emitted, cleanup };
};
