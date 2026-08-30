import type { Ephemeral, FluxEvent } from '@flux/protocol';
import { fileURLToPath } from 'node:url';

import { createEventLog } from '../src/create-event-log.ts';
import type { EventLog } from '../src/create-event-log.ts';
import { createGitService } from '../src/create-git-service.ts';
import { createSessionStore } from '../src/create-session-store.ts';
import type { SessionStore } from '../src/create-session-store.ts';
import type { SessionSupervisor, SpawnRequest } from '../src/create-session-supervisor.ts';
import { createSessionSupervisor } from '../src/create-session-supervisor.ts';
import { openDatabase } from '../src/open-database.ts';
import { piAdapter } from '../src/pi/pi-adapter.ts';
import { spawnPi } from '../src/pi/spawn-pi.ts';
import { tempWorktree } from './temp-worktree.ts';

// The pi twin of session-harness.ts: everything real on this side of the process boundary, the
// fixture-replaying fake pi on the other. `fixtures` names the runs the fake plays, in order.

const fake = fileURLToPath(new URL('./fake-pi.ts', import.meta.url));

export interface PiHarness {
  supervisor: SessionSupervisor;
  log: EventLog;
  sessions: SessionStore;
  emitted: FluxEvent[];
  ephemeral: Ephemeral[];
  spawns: SpawnRequest[];
  worktree: string;
}

export const piFixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/pi/${name}.jsonl`, import.meta.url));

export const piHarness = async (
  fixtures: string[],
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<PiHarness> => {
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
    harness: 'pi',
  });
  const emitted: FluxEvent[] = [];
  const ephemeral: Ephemeral[] = [];
  const spawns: SpawnRequest[] = [];
  const supervisor = createSessionSupervisor({
    record,
    log,
    sessions,
    git: createGitService(),
    adapter: piAdapter(worktree),
    spawn: (request) => {
      spawns.push(request);
      return spawnPi({
        cwd: request.cwd,
        session: request.session,
        sessionDir: worktree,
        command: fake,
        env: {
          ...process.env,
          FLUX_FAKE_FIXTURE: fixtures.map((name) => piFixture(name)).join(','),
          ...extraEnv,
        },
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
