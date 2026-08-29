import type { Ephemeral, FluxEvent } from '@flux/protocol';
import { fileURLToPath } from 'node:url';

import { claudeAdapter } from '../src/claude/claude-adapter.ts';
import { spawnClaude } from '../src/claude/spawn-claude.ts';
import { createEventLog } from '../src/create-event-log.ts';
import { createGitService } from '../src/create-git-service.ts';
import { createSessionStore } from '../src/create-session-store.ts';
import type {
  AgentAdapter,
  SessionSupervisor,
  SpawnRequest,
} from '../src/create-session-supervisor.ts';
import { createSessionSupervisor } from '../src/create-session-supervisor.ts';
import type { EventLog } from '../src/create-event-log.ts';
import type { SessionStore } from '../src/create-session-store.ts';
import { openDatabase } from '../src/open-database.ts';
import { tempWorktree } from './temp-worktree.ts';

// Everything real on this side of the process boundary, the fake agent on the other.

const fake = fileURLToPath(new URL('./fake-claude.ts', import.meta.url));
const fixture = fileURLToPath(
  new URL('./fixtures/claude/session-two-turns.jsonl', import.meta.url),
);

export interface SessionHarness {
  supervisor: SessionSupervisor;
  log: EventLog;
  sessions: SessionStore;
  emitted: FluxEvent[];
  ephemeral: Ephemeral[];
  spawns: SpawnRequest[];
  worktree: string;
}

// `adapter` replaces the real Claude read side, for tests of what the supervisor does with a
// mapping the fixtures cannot produce.
export const sessionHarness = async (
  extraEnv: NodeJS.ProcessEnv = {},
  adapter?: AgentAdapter,
): Promise<SessionHarness> => {
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
    agent: 'claude',
  });
  const emitted: FluxEvent[] = [];
  const ephemeral: Ephemeral[] = [];
  const spawns: SpawnRequest[] = [];
  const supervisor = createSessionSupervisor({
    record,
    log,
    sessions,
    git: createGitService(),
    adapter: adapter ?? claudeAdapter(worktree),
    spawn: (request) => {
      spawns.push(request);
      return spawnClaude({
        cwd: request.cwd,
        command: fake,
        ...(request.resume === undefined ? {} : { resume: request.resume }),
        env: { ...process.env, FLUX_FAKE_FIXTURE: fixture, ...extraEnv },
      });
    },
    emit: (event) => {
      emitted.push(event);
    },
    emitEphemeral: (message) => {
      ephemeral.push(message);
    },
  });
  return { supervisor, log, sessions, emitted, ephemeral, spawns, worktree };
};
