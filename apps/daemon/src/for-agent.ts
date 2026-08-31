import { claudeAdapter } from './claude/claude-adapter.ts';
import type { AgentProcess } from './claude/spawn-claude.ts';
import { spawnClaude } from './claude/spawn-claude.ts';
import type { CloseChildOptions } from './close-child.ts';
import type { SessionRecord } from './create-session-store.ts';
import type { AgentAdapter, SpawnRequest } from './create-session-supervisor.ts';
import type {
  OpencodeOptions,
  PiOptions,
  SupervisorPoolOptions,
} from './create-supervisor-pool.ts';
import { opencodeAdapter } from './opencode/opencode-adapter.ts';
import { spawnOpencode } from './opencode/spawn-opencode.ts';
import { piAdapter } from './pi/pi-adapter.ts';
import { spawnPi } from './pi/spawn-pi.ts';

// The session's harness picks its adapter pair and the flags a spawn compiles from the record
// (ADR 0007 claude, ADR 0016 pi, ADR 0027 opencode). Split out of create-supervisor-pool.ts so
// that file stays within its dependency budget; the pool calls `forAgent` and wires the result
// into the supervisor.

const closing = (options: SupervisorPoolOptions, session: string): CloseChildOptions => ({
  ...(options.closeGraceMs === undefined ? {} : { graceMs: options.closeGraceMs }),
  log: (stage) => {
    console.error(`flux daemon: session ${session}: closing agent, ${stage}`);
  },
});

const claudeSpawn =
  (options: SupervisorPoolOptions, record: SessionRecord) =>
  (request: SpawnRequest): AgentProcess =>
    spawnClaude({
      cwd: request.cwd,
      ...(request.resume === undefined ? {} : { resume: request.resume }),
      ...(options.claudeCommand === undefined ? {} : { command: options.claudeCommand }),
      ...(options.mcpConfig === undefined
        ? {}
        : { mcpConfig: options.mcpConfig(request.session, record.manager === true) }),
      ...(record.model === undefined ? {} : { model: record.model }),
      ...(record.effort === undefined ? {} : { effort: record.effort }),
      ...(record.role === undefined ? {} : { role: record.role }),
      ...(record.tools === undefined ? {} : { tools: record.tools }),
      close: closing(options, request.session),
    });

// The per-session model overrides pi's env default (`pi.model`); effort maps to `--thinking`.
// With neither set, pi keeps today's behaviour (its `FLUX_PI_MODEL` default and own settings).
const piSpawn =
  (options: SupervisorPoolOptions, pi: PiOptions, record: SessionRecord) =>
  (request: SpawnRequest): AgentProcess => {
    const model = record.model ?? pi.model;
    return spawnPi({
      cwd: request.cwd,
      session: request.session,
      sessionDir: pi.sessionDir,
      ...(pi.command === undefined ? {} : { command: pi.command }),
      ...(pi.extension === undefined ? {} : { extension: pi.extension }),
      ...(pi.provider === undefined ? {} : { provider: pi.provider }),
      ...(model === undefined ? {} : { model }),
      ...(record.effort === undefined ? {} : { thinking: record.effort }),
      ...(record.role === undefined ? {} : { role: record.role }),
      ...(options.env === undefined ? {} : { env: options.env(request.session) }),
      close: closing(options, request.session),
    });
  };

// opencode is process-per-turn (ADR 0027 § 3): the wrapper spawns a fresh `run` per turn and
// stays alive across turns. `OPENCODE_CONFIG` carries the tools floor + role (§ 4/§ 5) into every
// run, written under the data dir so the worktree's git state stays clean. `resume` is the stored
// opencode session id (`ses_…`); the model/effort map to `--model`/`--variant`.
const opencodeSpawn =
  (options: SupervisorPoolOptions, opencode: OpencodeOptions, record: SessionRecord) =>
  (request: SpawnRequest): AgentProcess => {
    const base = options.env === undefined ? process.env : options.env(request.session);
    const config = opencode.config(request.session, record.role);
    return spawnOpencode({
      cwd: request.cwd,
      env: { ...base, OPENCODE_CONFIG: config },
      ...(opencode.command === undefined ? {} : { command: opencode.command }),
      ...(request.resume === undefined ? {} : { resume: request.resume }),
      ...(record.model === undefined ? {} : { model: record.model }),
      ...(record.effort === undefined ? {} : { effort: record.effort }),
      close: closing(options, request.session),
    });
  };

export const forAgent = (
  options: SupervisorPoolOptions,
  record: SessionRecord,
): { spawn: (request: SpawnRequest) => AgentProcess; adapter: AgentAdapter } => {
  if (record.harness === 'pi' && options.pi !== undefined) {
    return { spawn: piSpawn(options, options.pi, record), adapter: piAdapter(record.worktree) };
  }
  if (record.harness === 'opencode' && options.opencode !== undefined) {
    return {
      spawn: opencodeSpawn(options, options.opencode, record),
      adapter: opencodeAdapter(record.worktree),
    };
  }
  return { spawn: claudeSpawn(options, record), adapter: claudeAdapter(record.worktree) };
};
