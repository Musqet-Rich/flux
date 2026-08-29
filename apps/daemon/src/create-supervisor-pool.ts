import type { Ephemeral, FluxEvent } from '@flux/protocol';

import { claudeAdapter } from './claude/claude-adapter.ts';
import type { AgentProcess } from './claude/spawn-claude.ts';
import { spawnClaude } from './claude/spawn-claude.ts';
import type { EventLog } from './create-event-log.ts';
import type { GitService } from './create-git-service.ts';
import type { SessionRecord, SessionStore } from './create-session-store.ts';
import type { AgentAdapter, SessionSupervisor, SpawnRequest } from './create-session-supervisor.ts';
import { createSessionSupervisor } from './create-session-supervisor.ts';
import { piAdapter } from './pi/pi-adapter.ts';
import { spawnPi } from './pi/spawn-pi.ts';

// One supervisor per live session, created on first use and closed on archive, restart or stop.
// The session's agent kind picks the adapter pair (ADR 0007 for claude, ADR 0016 for pi).

export interface SupervisorPool {
  get: (record: SessionRecord) => SessionSupervisor;
  close: (session: string) => Promise<void>;
  closeAll: () => Promise<void>;
}

export interface PiOptions {
  command?: string;
  // Where pi keeps its session files; the Flux session id names each one.
  sessionDir: string;
  extension?: string;
  provider?: string;
  model?: string;
}

export interface SupervisorPoolOptions {
  log: EventLog;
  sessions: SessionStore;
  git: GitService;
  claudeCommand?: string;
  pi?: PiOptions;
  // Path of the per-session MCP config injecting the Flux tools (ADR 0008).
  mcpConfig?: (session: string) => string;
  // Environment for the agent process; the pi extension finds the daemon through it.
  env?: (session: string) => NodeJS.ProcessEnv;
  emit: (event: FluxEvent) => void;
  emitEphemeral: (message: Ephemeral) => void;
}

const claudeSpawn =
  (options: SupervisorPoolOptions) =>
  (request: SpawnRequest): AgentProcess =>
    spawnClaude({
      cwd: request.cwd,
      ...(request.resume === undefined ? {} : { resume: request.resume }),
      ...(options.claudeCommand === undefined ? {} : { command: options.claudeCommand }),
      ...(options.mcpConfig === undefined ? {} : { mcpConfig: options.mcpConfig(request.session) }),
    });

const piSpawn =
  (options: SupervisorPoolOptions, pi: PiOptions) =>
  (request: SpawnRequest): AgentProcess =>
    spawnPi({
      cwd: request.cwd,
      session: request.session,
      sessionDir: pi.sessionDir,
      ...(pi.command === undefined ? {} : { command: pi.command }),
      ...(pi.extension === undefined ? {} : { extension: pi.extension }),
      ...(pi.provider === undefined ? {} : { provider: pi.provider }),
      ...(pi.model === undefined ? {} : { model: pi.model }),
      ...(options.env === undefined ? {} : { env: options.env(request.session) }),
    });

const forAgent = (
  options: SupervisorPoolOptions,
  record: SessionRecord,
): { spawn: (request: SpawnRequest) => AgentProcess; adapter: AgentAdapter } => {
  if (record.agent === 'pi' && options.pi !== undefined) {
    return { spawn: piSpawn(options, options.pi), adapter: piAdapter(record.worktree) };
  }
  return { spawn: claudeSpawn(options), adapter: claudeAdapter(record.worktree) };
};

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
      const created = createSessionSupervisor({ ...options, record, ...forAgent(options, record) });
      pool.set(record.session, created);
      return created;
    },
    close,
    closeAll: async () => {
      await Promise.all([...pool.keys()].map((session) => close(session)));
    },
  };
};
