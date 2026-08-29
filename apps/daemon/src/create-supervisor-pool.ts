import type { Ephemeral, FluxEvent } from '@flux/protocol';

import { spawnClaude } from './claude/spawn-claude.ts';
import type { GitService } from './create-git-service.ts';
import type { SessionRecord, SessionStore } from './create-session-store.ts';
import type { SessionSupervisor } from './create-session-supervisor.ts';
import { createSessionSupervisor } from './create-session-supervisor.ts';
import type { EventLog } from './create-event-log.ts';

// One supervisor per live session, created on first use and closed on archive, restart or stop.

export interface SupervisorPool {
  get: (record: SessionRecord) => SessionSupervisor;
  close: (session: string) => Promise<void>;
  closeAll: () => Promise<void>;
}

export interface SupervisorPoolOptions {
  log: EventLog;
  sessions: SessionStore;
  git: GitService;
  claudeCommand?: string;
  // Path of the per-session MCP config injecting the Flux tools (ADR 0008).
  mcpConfig?: (session: string) => string;
  emit: (event: FluxEvent) => void;
  emitEphemeral: (message: Ephemeral) => void;
}

export const createSupervisorPool = (options: SupervisorPoolOptions): SupervisorPool => {
  const pool = new Map<string, SessionSupervisor>();
  const close = async (session: string): Promise<void> => {
    const existing = pool.get(session);
    pool.delete(session);
    if (existing) await existing.close();
  };
  return {
    get: (record) => {
      const existing = pool.get(record.session);
      if (existing) return existing;
      const created = createSessionSupervisor({
        ...options,
        record,
        spawn: (request) =>
          spawnClaude({
            cwd: request.cwd,
            ...(request.resume === undefined ? {} : { resume: request.resume }),
            ...(options.claudeCommand === undefined ? {} : { command: options.claudeCommand }),
            ...(options.mcpConfig === undefined
              ? {}
              : { mcpConfig: options.mcpConfig(record.session) }),
          }),
      });
      pool.set(record.session, created);
      return created;
    },
    close,
    closeAll: async () => {
      await Promise.all([...pool.keys()].map((session) => close(session)));
    },
  };
};
