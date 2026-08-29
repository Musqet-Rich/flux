import type { Ephemeral, FluxEvent } from '@flux/protocol';
import { fileURLToPath } from 'node:url';

import { claudeAdapter } from '../src/claude/claude-adapter.ts';
import type { AgentProcess } from '../src/claude/spawn-claude.ts';
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

// The fake agent, spawned the way the pool spawns Claude, every request and process kept.
const spawner =
  (h: Pick<SessionHarness, 'spawns' | 'agents'>, command: string, extraEnv: NodeJS.ProcessEnv) =>
  (request: SpawnRequest): AgentProcess => {
    h.spawns.push(request);
    const agent = spawnClaude({
      cwd: request.cwd,
      command,
      ...(request.resume === undefined ? {} : { resume: request.resume }),
      env: { ...process.env, FLUX_FAKE_FIXTURE: fixture, ...extraEnv },
      close: { graceMs: 100 },
    });
    h.agents.push(agent);
    return agent;
  };

export interface SessionHarness {
  supervisor: SessionSupervisor;
  log: EventLog;
  sessions: SessionStore;
  emitted: FluxEvent[];
  ephemeral: Ephemeral[];
  spawns: SpawnRequest[];
  // Every process spawned, for a test that must see one exit.
  agents: AgentProcess[];
  worktree: string;
  // A fresh supervisor over the stored record, the way the pool makes one after a close.
  reopen: () => SessionSupervisor;
}

// `adapter` replaces the real Claude read side, for tests of what the supervisor does with a
// mapping the fixtures cannot produce; `command` replaces the fixture-replaying fake.
export const sessionHarness = async (
  extraEnv: NodeJS.ProcessEnv = {},
  adapter?: AgentAdapter,
  command = fake,
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
  const agents: AgentProcess[] = [];
  const build = (r: typeof record): SessionSupervisor =>
    createSessionSupervisor({
      record: r,
      log,
      sessions,
      git: createGitService(),
      adapter: adapter ?? claudeAdapter(worktree),
      spawn: spawner({ spawns, agents }, command, extraEnv),
      emit: (event) => {
        emitted.push(event);
      },
      emitEphemeral: (message) => {
        ephemeral.push(message);
      },
    });
  const supervisor = build(record);
  const reopen = (): SessionSupervisor => build(sessions.get(record.session));
  return { supervisor, log, sessions, emitted, ephemeral, spawns, agents, worktree, reopen };
};
