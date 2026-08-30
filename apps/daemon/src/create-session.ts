import type { RpcMethods, SessionSummary } from '@flux/protocol';

import { DaemonError } from './daemon-error.ts';
import type { HandlerContext } from './handler-context.ts';
import { inside } from './inside.ts';
import { resolveAgent } from './resolve-agent.ts';

// Creating a session (protocol.md § 7, `sessions.create`): resolve the Agent spec, make the
// worktree, persist the row, log `session.created`. Its own module so the manager surface (ADR
// 0025) can open a session through the exact same op the wire uses (`create-manager-ops.ts`)
// without a second value export on `create-session-handlers.ts`.

export const createSession = async (
  ctx: HandlerContext,
  params: RpcMethods['sessions.create']['params'],
): Promise<SessionSummary> => {
  if (!ctx.agents.includes(params.harness)) {
    throw new DaemonError('agent_unavailable', `${params.harness} is not installed on the box`);
  }
  // Resolve model/effort/role before any side effect, so an unknown agent fails with no worktree.
  const resolved = resolveAgent(params, ctx.settings.getAgents());
  const repo = inside(ctx.settings.get().reposDir, params.repo);
  const exists = (await ctx.git.branches(repo)).includes(params.branch);
  const base = await ctx.git.revParse(repo, params.base ?? (exists ? params.branch : 'HEAD'));
  const session = crypto.randomUUID();
  // `worktreesDir` is a normalised absolute path and `session` a UUID, so this is `join` here.
  const worktree = `${ctx.worktreesDir}/${session}`;
  await ctx.git.addWorktree(repo, worktree, params.branch, exists ? null : base);
  const record = ctx.sessions.create({
    session,
    title: params.title ?? params.branch,
    repo,
    worktree,
    branch: params.branch,
    base,
    harness: params.harness,
    ...resolved,
  });
  const { title } = record;
  ctx.log.append(session, {
    type: 'session.created',
    payload: { repo, worktree, branch: params.branch, base, harness: params.harness, title },
  });
  const summary = ctx.sessions.list().find((s) => s.session === session);
  if (summary === undefined) throw new DaemonError('internal', 'session vanished');
  return summary;
};
