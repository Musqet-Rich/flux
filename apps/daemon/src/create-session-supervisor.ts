import type { ChangedFile, CodeRef, Ephemeral, FluxEvent, SessionState } from '@flux/protocol';

import type { AgentProcess } from './claude/spawn-claude.ts';
import type { EventInput, EventLog } from './create-event-log.ts';
import type { GitService } from './create-git-service.ts';
import type { SessionRecord, SessionStore } from './create-session-store.ts';
import { renderRefs } from './render-refs.ts';

// One session = one agent process + one worktree + one event stream (architecture.md § Daemon).
// The supervisor owns the process lifecycle and is the only writer to this session's log. Which
// agent it is speaking to is the adapter's business: a stateful line mapper (read side) and a
// spawn function (write side), both chosen by the pool from the session's agent kind.

export interface SpawnRequest {
  cwd: string;
  session: string;
  resume?: string;
}

// What one agent line means to the supervisor, whichever agent produced it.
export interface Mapped {
  events: EventInput[];
  delta?: string;
  agentSessionId?: string;
  running?: boolean;
  turnEnded?: boolean;
  filesChanged?: boolean;
  // Ephemeral signals (protocol.md § 6): the thinking indicator and a git state change.
  thinking?: { active: boolean; estimatedTokens?: number };
  vcsChanged?: string;
}

export interface AgentAdapter {
  // Null for a line that is not JSON; the supervisor drops those.
  mapLine: (line: string) => Mapped | null;
  // Forget in-flight state when the process is gone.
  reset: () => void;
}

export interface SessionSupervisor {
  send: (text: string, refs?: CodeRef[], commentIds?: string[]) => Promise<number>;
  // A flux_ask in flight: waiting_user while true, back to running when answered.
  waiting: (on: boolean) => void;
  interrupt: () => void;
  close: () => Promise<void>;
  state: () => SessionState;
}

export interface SupervisorOptions {
  record: SessionRecord;
  log: EventLog;
  sessions: SessionStore;
  git: GitService;
  spawn: (request: SpawnRequest) => AgentProcess;
  adapter: AgentAdapter;
  emit: (event: FluxEvent) => void;
  emitEphemeral: (message: Ephemeral) => void;
}

interface Context extends SupervisorOptions {
  session: string;
  worktree: string;
  state: SessionState;
  agentSessionId: string | null;
  agent: AgentProcess | null;
  closing: boolean;
  // Lines are handled strictly in order even though some handlers await git.
  queue: Promise<void>;
}

const changedFile = (file: { path: string; status: string; from?: string }): ChangedFile => {
  const status = file.status === '?' ? 'A' : file.status;
  return {
    path: file.path,
    status: status === 'A' || status === 'D' || status === 'R' ? status : 'M',
    ...(file.from === undefined ? {} : { from: file.from }),
  };
};

const append = (ctx: Context, input: EventInput): FluxEvent => {
  const event = ctx.log.append(ctx.session, input);
  ctx.emit(event);
  return event;
};

const setState = (ctx: Context, next: SessionState, reason?: string): void => {
  if (ctx.state === next) return;
  ctx.state = next;
  ctx.sessions.setState(ctx.session, next);
  const payload = { state: next, ...(reason === undefined ? {} : { reason }) };
  append(ctx, { type: 'session.state', payload });
};

const handleLine = async (ctx: Context, line: string): Promise<void> => {
  const mapped = ctx.adapter.mapLine(line);
  if (mapped === null) return;
  if (mapped.agentSessionId !== undefined && mapped.agentSessionId !== ctx.agentSessionId) {
    ctx.agentSessionId = mapped.agentSessionId;
    ctx.sessions.setAgentSessionId(ctx.session, ctx.agentSessionId);
  }
  if (mapped.running === true) setState(ctx, 'running');
  if (mapped.delta !== undefined) {
    const forSeq = ctx.log.lastSeq(ctx.session) + 1;
    ctx.emitEphemeral({ type: 'delta', session: ctx.session, forSeq, text: mapped.delta });
  }
  if (mapped.thinking !== undefined) {
    ctx.emitEphemeral({ type: 'agent.thinking', session: ctx.session, ...mapped.thinking });
  }
  if (mapped.vcsChanged !== undefined) {
    ctx.emitEphemeral({ type: 'vcs.changed', session: ctx.session, kind: mapped.vcsChanged });
  }
  for (const event of mapped.events) append(ctx, event);
  if (mapped.filesChanged === true) {
    const files = (await ctx.git.status(ctx.worktree)).map((f) => changedFile(f));
    append(ctx, { type: 'files.changed', payload: { files } });
  }
  if (mapped.turnEnded === true) setState(ctx, 'idle');
};

// Returns a promise so it chains on the line queue like handleLine does.
const handleExit = (ctx: Context, code: number | null, stderr: string): Promise<void> => {
  ctx.agent = null;
  ctx.adapter.reset();
  if (!ctx.closing) {
    const why = code === null ? 'agent killed' : `agent exited with ${code}`;
    setState(ctx, 'ended', stderr === '' ? why : `${why}: ${stderr}`);
  }
  return Promise.resolve();
};

const ensureAgent = (ctx: Context): AgentProcess => {
  if (ctx.agent !== null) return ctx.agent;
  const resume = ctx.agentSessionId === null ? {} : { resume: ctx.agentSessionId };
  const agent = ctx.spawn({ cwd: ctx.worktree, session: ctx.session, ...resume });
  agent.onLine((line) => {
    ctx.queue = ctx.queue.then(() => handleLine(ctx, line));
  });
  agent.onExit((code) => {
    const stderr = agent.stderr();
    ctx.queue = ctx.queue.then(() => handleExit(ctx, code, stderr));
  });
  ctx.agent = agent;
  return agent;
};

const fileContent = (ctx: Context, ref: CodeRef): Promise<string | null> =>
  ctx.git.show(ctx.worktree, ref.path, ref.rev).then(
    (file) => (file.binary ? null : file.content),
    () => null,
  );

const send = async (
  ctx: Context,
  text: string,
  refs: CodeRef[],
  commentIds: string[],
): Promise<number> => {
  const contents = await Promise.all(refs.map((ref) => fileContent(ctx, ref)));
  const payload = {
    text,
    ...(refs.length === 0 ? {} : { refs }),
    ...(commentIds.length === 0 ? {} : { commentIds }),
  };
  const event = append(ctx, { type: 'msg.user', payload });
  ensureAgent(ctx).send(renderRefs(text, refs, contents));
  setState(ctx, 'running');
  return event.seq;
};

export const createSessionSupervisor = (options: SupervisorOptions): SessionSupervisor => {
  const ctx: Context = {
    ...options,
    session: options.record.session,
    worktree: options.record.worktree,
    state: options.record.state,
    agentSessionId: options.record.agentSessionId,
    agent: null,
    closing: false,
    queue: Promise.resolve(),
  };
  return {
    send: (text, refs = [], commentIds = []) => send(ctx, text, refs, commentIds),
    waiting: (on) => {
      setState(ctx, on ? 'waiting_user' : 'running');
    },
    interrupt: () => {
      ctx.agent?.interrupt();
    },
    close: async () => {
      ctx.closing = true;
      if (ctx.agent !== null) await ctx.agent.close();
      await ctx.queue;
    },
    state: () => ctx.state,
  };
};
