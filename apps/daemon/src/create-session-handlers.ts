import type { CodeRef, RpcMethods, SessionSummary, TokenUsage } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';
import { join } from 'node:path';

import { DaemonError } from './daemon-error.ts';
import type { HandlerContext } from './handler-context.ts';
import { inside } from './inside.ts';

// Session, agent, comment and event methods of protocol.md § 7.

export type SessionHandlers = Pick<
  {
    [M in keyof RpcMethods]: (params: RpcMethods[M]['params']) => Promise<RpcMethods[M]['result']>;
  },
  | 'hello'
  | 'events.sync'
  | 'sessions.list'
  | 'sessions.cost'
  | 'sessions.create'
  | 'sessions.archive'
  | 'sessions.restart'
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
  const repo = inside(ctx.reposDir, params.repo);
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

const sendMessage = async (
  ctx: HandlerContext,
  params: { session: string; text: string; commentIds?: string[] },
): Promise<{ seq: number }> => {
  const record = ctx.sessions.get(params.session);
  const commentIds = params.commentIds ?? [];
  const comments = ctx.comments.get(params.session, commentIds);
  const refs: CodeRef[] = comments.map((c) => c.ref);
  const seq = await ctx.supervisor(record).send(params.text, refs, commentIds);
  if (commentIds.length > 0) {
    ctx.comments.markSent(commentIds, seq);
    ctx.log.append(params.session, { type: 'comment.sent', payload: { commentIds, msgSeq: seq } });
  }
  return { seq };
};

export const createSessionHandlers = (ctx: HandlerContext): SessionHandlers => ({
  hello: () =>
    Promise.resolve({
      protocol: 1,
      daemon: ctx.daemonName,
      sessions: ctx.sessions.list(),
      vapidPublicKey: ctx.vapidPublicKey,
    }),
  'events.sync': (p) => Promise.resolve(ctx.log.read(p.session, p.since)),
  'sessions.list': () => Promise.resolve(ctx.sessions.list()),
  'sessions.cost': (p) => Promise.resolve(cost(ctx, ctx.sessions.get(p.session).session)),
  'sessions.create': (p) => createSession(ctx, p),
  'sessions.archive': async (p) => {
    ctx.sessions.get(p.session);
    await ctx.closeSupervisor(p.session);
    ctx.sessions.setArchived(p.session, true);
    return {};
  },
  'sessions.restart': async (p) => {
    ctx.sessions.get(p.session);
    await ctx.closeSupervisor(p.session);
    return {};
  },
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
