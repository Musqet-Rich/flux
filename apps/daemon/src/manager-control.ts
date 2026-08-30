import type { AgentSpec, FluxEvent, RpcMethods, SessionSummary } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';

import type { ControlRequest } from './create-control-socket.ts';
import type { EventLog } from './create-event-log.ts';
import type { SessionRecord, SessionStore } from './create-session-store.ts';
import type { SessionSupervisor } from './create-session-supervisor.ts';
import { DaemonError } from './daemon-error.ts';

// The manager surface (ADR 0025): a session marked `manager` may list / open / send / close / read
// OTHER sessions. Every verb is authorised against the CALLER's persisted `manager` flag (§5), so a
// hand-crafted control frame from a non-manager is rejected even though the socket is local. The
// four mutating verbs are audited to the TARGET session's log as `manager.acted` (§4); `list` is
// read-only and not audited. Lifecycle is not duplicated here: open and close call the same ops the
// RPC session-handlers use.

type OpenParams = RpcMethods['sessions.create']['params'];
type ManagerAction = 'open' | 'send' | 'close' | 'read';
type Audit = (target: string, action: ManagerAction, detail: string) => void;

export interface ManagerControlOptions {
  log: EventLog;
  sessions: SessionStore;
  supervisor: (record: SessionRecord) => SessionSupervisor;
  emit: (event: FluxEvent) => void;
  // The shared create op (create-session-handlers.ts), emitting `session.created` as it does on the
  // wire; returns the new session's summary.
  openSession: (params: OpenParams) => Promise<SessionSummary>;
  // The shared archive op (session-lifecycle.ts): closes the agent and hides the session.
  archiveSession: (session: string) => Promise<void>;
  // The saved Agents, to refuse opening a manager (§6).
  getAgents: () => AgentSpec[];
}

export type ManagerRequest = Extract<
  ControlRequest,
  { type: 'sessions.list' | 'session.open' | 'session.send' | 'session.close' | 'session.read' }
>;

const isManagerRequest = (request: ControlRequest): request is ManagerRequest =>
  request.type === 'sessions.list' ||
  request.type === 'session.open' ||
  request.type === 'session.send' ||
  request.type === 'session.close' ||
  request.type === 'session.read';

const readCap = 40;

// Flatten and cap a line so a busy session's read digest stays small enough to supervise from.
const clip = (text: string): string => {
  const flat = text.replaceAll('\n', ' ');
  return flat.length > 120 ? `${flat.slice(0, 117)}…` : flat;
};

// One line of a target's activity, roles and short text, for the read digest; null for events that
// do not belong in a supervision summary. If-chains, not a switch, keep the union narrowing without
// listing every event type the daemon knows.
const digestLine = (event: FluxEvent): string | null => {
  if (!fluxEvent.isKnown(event)) return null;
  if (event.type === 'msg.user') return `user: ${clip(event.payload.text)}`;
  if (event.type === 'msg.assistant') return `assistant: ${clip(event.payload.text)}`;
  if (event.type === 'tool.start' || event.type === 'tool.end') {
    return `tool: ${clip(event.payload.summary)}`;
  }
  if (event.type === 'notify')
    return `notify (${event.payload.level}): ${clip(event.payload.summary)}`;
  if (event.type === 'ask') return `ask: ${clip(event.payload.question)}`;
  if (event.type === 'session.state') return `state: ${event.payload.state}`;
  return null;
};

const makeAudit =
  (options: ManagerControlOptions, actor: string): Audit =>
  (target, action, detail) => {
    options.emit(
      options.log.append(target, {
        type: 'manager.acted',
        payload: { actor, action, target, detail },
      }),
    );
  };

const listFleet = (sessions: SessionStore): unknown => ({
  sessions: sessions.list().map((s) => ({
    session: s.session,
    title: s.title,
    harness: s.harness,
    state: s.state,
    repo: s.repo,
    branch: s.branch,
  })),
});

// Authorise, then dispatch. `caller` is looked up by its session id (its FLUX_SESSION): a session
// the store does not know, or one whose persisted `manager` flag is not true, is refused (§5).
const handleManagerRequest = async (
  options: ManagerControlOptions,
  request: ManagerRequest,
): Promise<unknown> => {
  const caller = options.sessions.get(request.session);
  if (caller.manager !== true) {
    throw new DaemonError('bad_params', `session ${request.session} is not a manager`);
  }
  const audit = makeAudit(options, request.session);
  if (request.type === 'sessions.list') return listFleet(options.sessions);
  if (request.type === 'session.open') return openTarget(options, request, audit);
  if (request.target === request.session) {
    throw new DaemonError('bad_params', 'a manager cannot target its own session');
  }
  const target = options.sessions.get(request.target);
  if (request.type === 'session.send') return sendToTarget(options, target, request.text, audit);
  if (request.type === 'session.close') return closeTarget(options, target, audit);
  return readTarget(options, request, target, audit);
};

// A manager cannot open another manager (§6): a named Agent flagged `manager` is refused before any
// worktree is made. An unknown name falls through to the create op, which rejects it as bad_params.
const openTarget = async (
  options: ManagerControlOptions,
  request: Extract<ManagerRequest, { type: 'session.open' }>,
  audit: Audit,
): Promise<unknown> => {
  if (request.agent !== undefined) {
    const named = options.getAgents().find((a) => a.name === request.agent);
    if (named?.manager === true) {
      throw new DaemonError('bad_params', 'a manager cannot open another manager');
    }
  }
  const params: OpenParams = {
    repo: request.repo,
    branch: request.branch,
    harness: request.harness,
    ...(request.agent === undefined ? {} : { agent: request.agent }),
    ...(request.model === undefined ? {} : { model: request.model }),
    ...(request.effort === undefined ? {} : { effort: request.effort }),
    ...(request.base === undefined ? {} : { base: request.base }),
    ...(request.title === undefined ? {} : { title: request.title }),
  };
  const summary = await options.openSession(params);
  audit(summary.session, 'open', `${summary.harness} on ${summary.branch}`);
  return { session: summary.session, title: summary.title };
};

const sendToTarget = async (
  options: ManagerControlOptions,
  target: SessionRecord,
  text: string,
  audit: Audit,
): Promise<unknown> => {
  if (target.archived) throw new DaemonError('bad_params', `session ${target.session} is archived`);
  const seq = await options.supervisor(target).send(text);
  audit(target.session, 'send', clip(text));
  return { seq };
};

const closeTarget = async (
  options: ManagerControlOptions,
  target: SessionRecord,
  audit: Audit,
): Promise<unknown> => {
  if (target.archived) {
    throw new DaemonError('bad_params', `session ${target.session} is already archived`);
  }
  await options.archiveSession(target.session);
  audit(target.session, 'close', `archived ${target.title}`);
  return { archived: target.session };
};

const readTarget = (
  options: ManagerControlOptions,
  request: Extract<ManagerRequest, { type: 'session.read' }>,
  target: SessionRecord,
  audit: Audit,
): unknown => {
  const limit = request.limit ?? readCap;
  const last = options.log.lastSeq(target.session);
  const since = Math.max(0, last - limit);
  const events = options.log.read(target.session, since, limit).events;
  const lines = events.map((e) => digestLine(e)).filter((line): line is string => line !== null);
  const digest = lines.length === 0 ? '(no recent activity)' : lines.join('\n');
  audit(target.session, 'read', `read ${lines.length} of the last ${events.length} events`);
  return { digest, count: lines.length };
};

// One value export per file (engineering.md § Code style): the guard and the handler as one object.
export const managerControl: {
  is: typeof isManagerRequest;
  handle: typeof handleManagerRequest;
} = { is: isManagerRequest, handle: handleManagerRequest };
