import type { HarnessKind, SessionSummary } from '@flux/protocol';

import { DaemonError } from './daemon-error.ts';
import type { HandlerContext } from './handler-context.ts';
import type { AgentResolution } from './resolve-agent.ts';

// Creating a session (protocol.md § 7, `sessions.create`): make the worktree, persist the row, log
// `session.created`. Its own module so the manager surface (ADR 0025) and the Help path (ADR 0008,
// `create-help.ts`) open a session through the exact same op the wire uses, without duplicating
// create logic.
//
// Repo resolution is the CALLER's job (ADR 0008): the wire handler and the manager op resolve the
// repo under `reposDir` (`resolve-create-params.ts`), while the Help path passes its own repo under
// the data dir. So `createSession` takes an already-resolved absolute `repo` and never touches
// `reposDir` itself — the `inside`-under-`reposDir` guard stays with the caller.

// The resolved shape `createSession` needs: an absolute repo, the branch/base/title, the runtime
// harness, and the resolved model/effort/role/tools/manager (AgentResolution). No `agent` name and
// no `reposDir`-relative path survive to here.
export interface SessionSpec {
  repo: string;
  branch: string;
  base?: string;
  harness: HarnessKind;
  title?: string;
  resolution: AgentResolution;
}

export const createSession = async (
  ctx: HandlerContext,
  spec: SessionSpec,
): Promise<SessionSummary> => {
  if (!ctx.agents.includes(spec.harness)) {
    throw new DaemonError('agent_unavailable', `${spec.harness} is not installed on the box`);
  }
  const exists = (await ctx.git.branches(spec.repo)).includes(spec.branch);
  const base = await ctx.git.revParse(spec.repo, spec.base ?? (exists ? spec.branch : 'HEAD'));
  const session = crypto.randomUUID();
  // `worktreesDir` is a normalised absolute path and `session` a UUID, so this is `join` here.
  const worktree = `${ctx.worktreesDir}/${session}`;
  await ctx.git.addWorktree(spec.repo, worktree, spec.branch, exists ? null : base);
  const record = ctx.sessions.create({
    session,
    title: spec.title ?? spec.branch,
    repo: spec.repo,
    worktree,
    branch: spec.branch,
    base,
    harness: spec.harness,
    ...spec.resolution,
  });
  const { title } = record;
  ctx.log.append(session, {
    type: 'session.created',
    payload: { repo: spec.repo, worktree, branch: spec.branch, base, harness: spec.harness, title },
  });
  const summary = ctx.sessions.list().find((s) => s.session === session);
  if (summary === undefined) throw new DaemonError('internal', 'session vanished');
  return summary;
};
