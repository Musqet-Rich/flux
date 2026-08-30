import type { CodeRef, RpcMethods, SessionSummary, TokenUsage } from '@flux/protocol';
import { attachment, fluxEvent, protocolVersion } from '@flux/protocol';
import { join } from 'node:path';

import type { Peer } from './create-device-channels.ts';
import { DaemonError } from './daemon-error.ts';
import type { HandlerContext } from './handler-context.ts';
import { inside } from './inside.ts';
import { quotedMessage } from './quoted-message.ts';
import type { Reply } from './render-reply.ts';
import { sessionLifecycle } from './session-lifecycle.ts';
import { version } from './version.ts';

// Session, agent, comment and event methods of protocol.md § 7.

export type SessionHandlers = Pick<
  {
    [M in keyof RpcMethods]: (
      params: RpcMethods[M]['params'],
      peer: Peer,
    ) => Promise<RpcMethods[M]['result']>;
  },
  | 'hello'
  | 'events.sync'
  | 'sessions.list'
  | 'sessions.cost'
  | 'sessions.create'
  | 'sessions.archive'
  | 'sessions.unarchive'
  | 'sessions.clear'
  | 'sessions.restart'
  | 'sessions.rename'
  | 'agent.send'
  | 'agent.answer'
  | 'agent.interrupt'
  | 'comments.add'
  | 'comments.remove'
>;

const usageKeys = ['input', 'output', 'cacheRead', 'cacheWrite'] as const;

const cost = (ctx: HandlerContext, session: string) => {
  let costUsd = 0;
  let turns = 0;
  const usage: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let since = 0;
  for (;;) {
    const page = ctx.log.read(session, since);
    for (const event of page.events) {
      if (!fluxEvent.isKnown(event) || event.type !== 'turn.ended') continue;
      turns += 1;
      costUsd += event.payload.costUsd ?? 0;
      for (const key of usageKeys) usage[key] += event.payload.usage?.[key] ?? 0;
    }
    if (page.complete) break;
    since = page.events.at(-1)?.seq ?? since;
  }
  return { costUsd, usage, turns };
};

const createSession = async (
  ctx: HandlerContext,
  params: { repo: string; branch: string; base?: string; agent: 'claude' | 'pi'; title?: string },
): Promise<SessionSummary> => {
  if (!ctx.agents.includes(params.agent)) {
    throw new DaemonError('agent_unavailable', `${params.agent} is not installed on the box`);
  }
  const repo = inside(ctx.settings.get().reposDir, params.repo);
  const exists = (await ctx.git.branches(repo)).includes(params.branch);
  const base = await ctx.git.revParse(repo, params.base ?? (exists ? params.branch : 'HEAD'));
  const session = crypto.randomUUID();
  const worktree = join(ctx.worktreesDir, session);
  await ctx.git.addWorktree(repo, worktree, params.branch, exists ? null : base);
  const record = ctx.sessions.create({
    session,
    title: params.title ?? params.branch,
    repo,
    worktree,
    branch: params.branch,
    base,
    agent: params.agent,
  });
  const { title } = record;
  ctx.log.append(session, {
    type: 'session.created',
    payload: { repo, worktree, branch: params.branch, base, agent: params.agent, title },
  });
  const summary = ctx.sessions.list().find((s) => s.session === session);
  if (summary === undefined) throw new DaemonError('internal', 'session vanished');
  return summary;
};

// The message a reply answers, read from the log so the quote the agent sees is the log's text.
// `log.read` is per session, so a seq from another session's log is not found here.
const quoted = (ctx: HandlerContext, session: string, seq: number): Reply => {
  const event = ctx.log.read(session, seq - 1, 1).events.find((e) => e.seq === seq);
  const reply = quotedMessage(event);
  if (reply === null) {
    throw new DaemonError('bad_params', `replyTo ${seq} is not a message in this session`);
  }
  return reply;
};

// The attachments a message names must be complete, the session's own, and within the
// per-message cap together (ADR 0020); the store checks the first two.
const attached = (ctx: HandlerContext, session: string, ids: string[]) => {
  if (new Set(ids).size !== ids.length) {
    throw new DaemonError('bad_params', 'an attachment is named twice');
  }
  const files = ctx.attachments.get(session, ids);
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > attachment.limits.messageBytes) {
    throw new DaemonError('too_large', 'attachments on one message may total at most 50 MiB');
  }
  return files;
};

const sendMessage = async (
  ctx: HandlerContext,
  params: RpcMethods['agent.send']['params'],
): Promise<{ seq: number }> => {
  const record = ctx.sessions.get(params.session);
  const commentIds = params.commentIds ?? [];
  const comments = ctx.comments.get(params.session, commentIds);
  const refs: CodeRef[] = comments.map((c) => c.ref);
  const reply = params.replyTo === undefined ? null : quoted(ctx, params.session, params.replyTo);
  const ids = params.attachments ?? [];
  const files = attached(ctx, params.session, ids);
  const seq = await ctx.supervisor(record).send(params.text, refs, commentIds, reply, files);
  if (ids.length > 0) ctx.attachments.markSent(ids, seq);
  if (commentIds.length > 0) {
    ctx.comments.markSent(commentIds, seq);
    ctx.log.append(params.session, { type: 'comment.sent', payload: { commentIds, msgSeq: seq } });
  }
  return { seq };
};

export const createSessionHandlers = (ctx: HandlerContext): SessionHandlers => ({
  hello: (_p, peer) => {
    if (peer.device !== null) ctx.devices.touch(peer.device.deviceId);
    return Promise.resolve({
      protocol: protocolVersion,
      daemon: ctx.daemonName,
      sessions: ctx.sessions.list(),
      vapidPublicKey: ctx.vapidPublicKey,
      agents: ctx.agents,
      version,
    });
  },
  'events.sync': (p) => Promise.resolve(ctx.log.read(p.session, p.since)),
  'sessions.list': () => Promise.resolve(ctx.sessions.list()),
  'sessions.cost': (p) => Promise.resolve(cost(ctx, ctx.sessions.get(p.session).session)),
  'sessions.create': (p) => createSession(ctx, p),
  'sessions.archive': (p) => sessionLifecycle.archive(ctx, p),
  'sessions.unarchive': (p) => sessionLifecycle.unarchive(ctx, p.session),
  'sessions.clear': (p) => sessionLifecycle.clear(ctx, p.session),
  'sessions.restart': async (p) => {
    ctx.sessions.get(p.session);
    await ctx.closeSupervisor(p.session);
    return {};
  },
  'sessions.rename': (p) => Promise.resolve(sessionLifecycle.rename(ctx, p.session, p.title)),
  'agent.send': (p) => sendMessage(ctx, p),
  'agent.answer': (p) => {
    if (!ctx.asks.answer(p.askId, p.answer)) throw new DaemonError('not_found', 'no such ask');
    return Promise.resolve({});
  },
  'agent.interrupt': (p) => {
    ctx.supervisor(ctx.sessions.get(p.session)).interrupt();
    return Promise.resolve({});
  },
  'comments.add': (p) => {
    ctx.sessions.get(p.session);
    const { commentId, ref, text } = ctx.comments.add(p.session, p.ref, p.text);
    ctx.log.append(p.session, { type: 'comment.added', payload: { commentId, ref, text } });
    return Promise.resolve({ commentId });
  },
  'comments.remove': (p) => {
    ctx.comments.remove(p.session, p.commentId);
    ctx.log.append(p.session, { type: 'comment.removed', payload: { commentId: p.commentId } });
    return Promise.resolve({});
  },
});
