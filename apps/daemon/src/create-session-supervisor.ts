import type {
  Attachment,
  ChangedFile,
  CodeRef,
  Ephemeral,
  FluxEvent,
  SessionState,
} from '@flux/protocol';
import { attachment, fluxEvent } from '@flux/protocol';

import { attachmentImages } from './attachment-images.ts';
import { contextWindow } from './claude/context-window.ts';
import type { AgentProcess } from './claude/spawn-claude.ts';
import type { EventInput, EventLog } from './create-event-log.ts';
import type { GitService } from './create-git-service.ts';
import type { SessionRecord, SessionStore } from './create-session-store.ts';
import { DaemonError } from './daemon-error.ts';
import type { PromptInput } from './render-prompt.ts';
import { renderPrompt } from './render-prompt.ts';

// The reply shape is named through the prompt's input rather than imported from render-reply.ts
// to stay inside the per-file import budget.
type Reply = NonNullable<PromptInput['reply']>;

// One session = one agent process + one worktree + one event stream (architecture.md § Daemon).
// The supervisor owns the process lifecycle and is the only writer to this session's log. Which
// agent it is speaking to is the adapter's business: a stateful line mapper (read side) and a
// spawn function (write side), both chosen by the pool from the session's agent kind.

export interface SpawnRequest {
  cwd: string;
  session: string;
  resume?: string;
  // The effort to ask for: the session's configured one (ADR 0023 § 3) until the operator sets
  // another in-band (ADR 0031), kept on the record so every later spawn asks for it too.
  effort?: string;
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
  // The prompt size of one model call and the model that took it, for the status bar's context
  // reading. The supervisor names the window (context-window.ts); the mappers stay pure.
  context?: { tokens: number; model: string };
  // What the agent says it is running, whenever it says so (protocol.md § 5 `agent.spec`); the
  // supervisor logs it when it differs from the last one logged, so the mappers need no memory.
  spec?: RunningSpec;
  // An effort the operator set in-band and the agent confirmed (ADR 0031): the supervisor keeps
  // it on the record, so the next spawn, whatever its cause, asks for it.
  chosen?: { effort: string };
}

export interface RunningSpec {
  model: string;
  effort?: string;
}

export interface AgentAdapter {
  // Null for a line that is not JSON; the supervisor drops those.
  mapLine: (line: string) => Mapped | null;
  // Forget in-flight state when the process is gone.
  reset: () => void;
}

// A stored attachment as the message carries it: what the log records plus where it is.
export interface AttachedRecord {
  id: string;
  name: string;
  mime: string;
  size: number;
  path: string;
}

export interface SessionSupervisor {
  // `reply` is the message this one answers, already read from the log by the caller;
  // `attachments` are the files stored for it (create-attachment-store.ts).
  send: (
    text: string,
    refs?: CodeRef[],
    commentIds?: string[],
    reply?: Reply | null,
    attachments?: AttachedRecord[],
  ) => Promise<number>;
  // A flux_ask in flight: waiting_user while true, back to running when answered.
  waiting: (on: boolean) => void;
  interrupt: () => void;
  close: () => Promise<void>;
  // The agent's group is SIGKILLed now, nothing awaited (a shutdown that cannot wait).
  kill: () => void;
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
  // Where HEAD was last found, checked against the worktree whenever the agent, or the operator
  // on the box between agents, may have moved it, so the device's label follows a `git switch`.
  head: string;
  // The check a message with no agent to go to is waiting on; shared, so two messages arriving
  // together are logged in the order they came.
  spawnCheck: Promise<void> | null;
  state: SessionState;
  agentSessionId: string | null;
  // The last `agent.spec` in the log, so a repeat from the agent (every `message_start` names
  // the model) is not a row, across daemon restarts too. Null until the agent first says.
  spec: RunningSpec | null;
  // The effort the next spawn asks for: the record's, updated as the operator chooses.
  effort: string | undefined;
  agent: AgentProcess | null;
  closing: boolean;
  // Counts closes, so a message that was being prepared (its refs read, its head check run)
  // when one came can tell, and is refused rather than spawning an agent behind it.
  closes: number;
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

// A spec with no effort says the effort is unknown, not that there is none: a fresh process
// restating the model before its transcript has a line does not unsay the effort on record.
const restates = (next: RunningSpec, last: RunningSpec | null): boolean =>
  last !== null &&
  next.model === last.model &&
  (next.effort === undefined || next.effort === last.effort);

const lastSpec = (log: EventLog, session: string): RunningSpec | null => {
  const event = log.lastOfType(session, 'agent.spec');
  return event !== null && fluxEvent.isKnown(event) && event.type === 'agent.spec'
    ? event.payload
    : null;
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

// A worktree git cannot read (gone from disk) leaves the record as it was.
const checkHead = async (ctx: Context): Promise<void> => {
  const head = await ctx.git.head(ctx.worktree).catch(() => null);
  if (head === null || head === ctx.head) return;
  ctx.head = head;
  ctx.sessions.setHead(ctx.session, head);
  append(ctx, { type: 'session.head', payload: { head } });
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
    await checkHead(ctx);
  }
  if (mapped.context !== undefined) {
    const window = contextWindow(mapped.context.model);
    ctx.emitEphemeral({
      type: 'agent.context',
      session: ctx.session,
      ...mapped.context,
      ...(window === undefined ? {} : { window }),
    });
  }
  for (const event of mapped.events) append(ctx, event);
  if (mapped.chosen !== undefined && mapped.chosen.effort !== ctx.effort) {
    ctx.effort = mapped.chosen.effort;
    ctx.sessions.setEffort(ctx.session, ctx.effort);
  }
  if (mapped.spec !== undefined && !restates(mapped.spec, ctx.spec)) {
    ctx.spec = mapped.spec;
    append(ctx, { type: 'agent.spec', payload: mapped.spec });
  }
  if (mapped.filesChanged === true) {
    const files = (await ctx.git.status(ctx.worktree)).map((f) => changedFile(f));
    append(ctx, { type: 'files.changed', payload: { files } });
  }
  // The check once per turn, as it ends; a stream that says so again while idle is not one.
  if (mapped.turnEnded === true && ctx.state !== 'idle') {
    await checkHead(ctx);
    setState(ctx, 'idle');
  }
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
  const effort = ctx.effort === undefined ? {} : { effort: ctx.effort };
  const agent = ctx.spawn({ cwd: ctx.worktree, session: ctx.session, ...resume, ...effort });
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

const logged = (files: AttachedRecord[]): Attachment[] =>
  files.map(({ id, name, mime, size }) => ({
    id,
    name,
    mime,
    size,
    image: attachment.isImage(mime, size),
  }));

// HEAD may have moved while no agent ran (the operator, on the box): a move logged before the
// message it precedes, and after the last agent's lines. A line that failed (git in a worktree
// gone from under it) has rejected the queue; that is not this message's error to raise.
const headBeforeSpawn = (ctx: Context): Promise<void> => {
  ctx.spawnCheck ??= ctx.queue
    .catch(() => {})
    .then(() => checkHead(ctx))
    .finally(() => {
      ctx.spawnCheck = null;
    });
  return ctx.spawnCheck;
};

const closedMeanwhile = (): DaemonError =>
  new DaemonError('conflict', 'the session closed while the message was being prepared');

const send = async (
  ctx: Context,
  text: string,
  refs: CodeRef[],
  commentIds: string[],
  reply: Reply | null,
  attachments: AttachedRecord[],
): Promise<number> => {
  const { closes } = ctx;
  const [contents, images] = await Promise.all([
    Promise.all(refs.map((ref) => fileContent(ctx, ref))),
    attachmentImages(attachments),
  ]);
  // Refused before the head check as well as after it, so a close that came while the refs
  // were read does not have the check write to a session being archived.
  if (ctx.closes !== closes) throw closedMeanwhile();
  if (ctx.agent === null) await headBeforeSpawn(ctx);
  if (ctx.closes !== closes) throw closedMeanwhile();
  const payload = {
    text,
    ...(refs.length === 0 ? {} : { refs }),
    ...(commentIds.length === 0 ? {} : { commentIds }),
    ...(reply === null ? {} : { replyTo: reply.seq }),
    ...(attachments.length === 0 ? {} : { attachments: logged(attachments) }),
  };
  const event = append(ctx, { type: 'msg.user', payload });
  const prompt = renderPrompt({ text, refs, contents, reply, attachments });
  ensureAgent(ctx).send(prompt, images);
  setState(ctx, 'running');
  return event.seq;
};

export const createSessionSupervisor = (options: SupervisorOptions): SessionSupervisor => {
  const ctx: Context = {
    ...options,
    session: options.record.session,
    worktree: options.record.worktree,
    head: options.record.head ?? options.record.branch,
    spawnCheck: null,
    state: options.record.state,
    agentSessionId: options.record.agentSessionId,
    spec: lastSpec(options.log, options.record.session),
    effort: options.record.effort,
    agent: null,
    closing: false,
    closes: 0,
    queue: Promise.resolve(),
  };
  return {
    send: (text, refs = [], commentIds = [], reply = null, attachments = []) =>
      send(ctx, text, refs, commentIds, reply, attachments),
    // An answer that lands after close (the ask's connection dropping with the agent) must not
    // put a closed session back to running.
    waiting: (on) => {
      if (ctx.closing) return;
      setState(ctx, on ? 'waiting_user' : 'running');
    },
    interrupt: () => {
      ctx.agent?.interrupt();
    },
    // The agent is gone on purpose (stop, archive, restart), so a session caught mid-turn is
    // idle now, not running forever: the next message resumes it.
    close: async () => {
      ctx.closing = true;
      ctx.closes += 1;
      if (ctx.agent !== null) await ctx.agent.close();
      await ctx.queue;
      // A message waiting on its head check is refused once this returns (`closes`); waiting
      // for a check already running keeps its `setHead` from landing on a session being archived.
      await ctx.spawnCheck;
      if (ctx.state === 'running' || ctx.state === 'waiting_user') {
        setState(ctx, 'idle', 'agent closed');
      }
    },
    kill: () => {
      ctx.closing = true;
      ctx.closes += 1;
      ctx.agent?.kill();
    },
    state: () => ctx.state,
  };
};
