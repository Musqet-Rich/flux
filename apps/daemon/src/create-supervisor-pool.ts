import type { Ephemeral, FluxEvent } from '@flux/protocol';

import type { EventLog } from './create-event-log.ts';
import type { GitService } from './create-git-service.ts';
import type { SessionRecord, SessionStore } from './create-session-store.ts';
import type { SessionSupervisor } from './create-session-supervisor.ts';
import { createSessionSupervisor } from './create-session-supervisor.ts';
import { forAgent } from './for-agent.ts';

// One supervisor per live session, created on first use and closed on archive, restart or stop.
// The session's harness picks the adapter pair (for-agent.ts): ADR 0007 claude, ADR 0016 pi,
// ADR 0027 opencode.

export interface SupervisorPool {
  get: (record: SessionRecord) => SessionSupervisor;
  close: (session: string) => Promise<void>;
  closeAll: () => Promise<void>;
  // Every agent's group SIGKILLed now, for a shutdown that cannot wait for closeAll.
  killAll: () => void;
}

export interface PiOptions {
  command?: string;
  // Where pi keeps its session files; the Flux session id names each one.
  sessionDir: string;
  extension?: string;
  provider?: string;
  model?: string;
}

export interface OpencodeOptions {
  command?: string;
  // Writes the per-session opencode config (tools floor + role, ADR 0027 § 4/§ 5) under the flux
  // data dir and returns its path for `OPENCODE_CONFIG`; nothing is written into the worktree.
  config: (session: string, role?: string) => string;
}

export interface SupervisorPoolOptions {
  log: EventLog;
  sessions: SessionStore;
  git: GitService;
  claudeCommand?: string;
  pi?: PiOptions;
  opencode?: OpencodeOptions;
  // Path of the per-session MCP config injecting the Flux tools (ADR 0008); a manager session
  // (ADR 0025) also gets the `flux-manager` server, so the second argument carries that flag.
  mcpConfig?: (session: string, manager: boolean) => string;
  // Environment for the agent process; the pi extension finds the daemon through it.
  env?: (session: string) => NodeJS.ProcessEnv;
  emit: (event: FluxEvent) => void;
  emitEphemeral: (message: Ephemeral) => void;
  // How patiently an agent is closed (close-child.ts); the daemon's shutdown budget rests on it.
  closeGraceMs?: number;
}

export const createSupervisorPool = (options: SupervisorPoolOptions): SupervisorPool => {
  const pool = new Map<string, SessionSupervisor>();
  // Leaves the pool at once (a restart makes a fresh one meanwhile) but stays reachable by
  // killAll until its agent is gone: a shutdown cut short mid-close must still find it.
  const leaving = new Set<SessionSupervisor>();
  const close = async (session: string): Promise<void> => {
    const existing = pool.get(session);
    pool.delete(session);
    if (!existing) return;
    leaving.add(existing);
    await existing.close();
    leaving.delete(existing);
  };
  return {
    get: (record) => {
      const existing = pool.get(record.session);
      if (existing) return existing;
      const created = createSessionSupervisor({ ...options, record, ...forAgent(options, record) });
      pool.set(record.session, created);
      return created;
    },
    close,
    closeAll: async () => {
      await Promise.all([...pool.keys()].map((session) => close(session)));
    },
    killAll: () => {
      for (const supervisor of [...pool.values(), ...leaving]) supervisor.kill();
    },
  };
};
