import type { RpcMethods, SessionSummary } from '@flux/protocol';

import type { SessionSpec } from './create-session.ts';
import { createSession } from './create-session.ts';
import { DaemonError } from './daemon-error.ts';
import { ensureHelpRepo } from './ensure-help-repo.ts';
import type { HandlerContext } from './handler-context.ts';
import { helpAgentSpec } from './help-agent-spec.ts';
import { inside } from './inside.ts';
import { resolveAgent } from './resolve-agent.ts';

// The two RPC-facing create operations (ADR 0008/0023), over the `createSession` primitive
// (create-session.ts). Bundled as one object so repo resolution is the caller's job without three
// separate exports: `fromParams` resolves a wire `sessions.create` under `reposDir` and creates;
// `help` opens a daemon-managed Help session on the throwaway help repo. The `sessions.create`
// handler and the manager open op (ADR 0025) both go through `fromParams`, so they resolve
// identically; the Help path never touches `reposDir`.

// Resolve a wire `sessions.create`: the repo under `reposDir` (the `inside` guard rejects
// traversal, so a foreign path never reaches disk) and the Agent fields (inline → saved Agent →
// default). An unknown `agent` name is `bad_params` here, before any worktree is made.
const resolveParams = (
  ctx: HandlerContext,
  params: RpcMethods['sessions.create']['params'],
): SessionSpec => {
  const resolution = resolveAgent(params, ctx.settings.getAgents());
  const repo = inside(ctx.settings.get().reposDir, params.repo);
  return {
    repo,
    branch: params.branch,
    ...(params.base === undefined ? {} : { base: params.base }),
    harness: params.harness,
    ...(params.title === undefined ? {} : { title: params.title }),
    resolution,
  };
};

// The first line of the question, trimmed and capped, as the Help session's tab title.
const helpTitle = (question: string): string => {
  const line = question.split('\n')[0]?.trim() ?? question;
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
};

const help = async (
  ctx: HandlerContext,
  params: RpcMethods['sessions.createHelp']['params'],
): Promise<SessionSummary> => {
  const question = params.question.trim();
  if (question === '') throw new DaemonError('bad_params', 'question must not be blank');
  const repo = await ensureHelpRepo(ctx.env.dataDir, ctx.git);
  // The shared Help role/tools are applied inline (not via a saved Agent), so a Help session works
  // even if the operator deleted the saved "Help" Agent.
  const summary = await createSession(ctx, {
    repo,
    branch: `help-${crypto.randomUUID().slice(0, 8)}`,
    harness: 'claude',
    title: helpTitle(question),
    resolution: { role: helpAgentSpec.role, tools: helpAgentSpec.tools },
  });
  // Deliver the question as the first user turn, the same path `agent.send` uses.
  await ctx.supervisor(ctx.sessions.get(summary.session)).send(question);
  return summary;
};

export const sessionCreateOps = {
  fromParams: (
    ctx: HandlerContext,
    params: RpcMethods['sessions.create']['params'],
  ): Promise<SessionSummary> => createSession(ctx, resolveParams(ctx, params)),
  help,
};
