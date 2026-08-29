import { access } from 'node:fs/promises';

import type { SessionRecord } from './create-session-store.ts';
import { DaemonError } from './daemon-error.ts';
import type { HandlerContext } from './handler-context.ts';
import { settleAsks } from './settle-asks.ts';

// Ending a session and coming back (protocol.md § 7: `sessions.archive`, `sessions.unarchive`,
// `sessions.clear`). Archiving always closes the agent; removing the worktree is the operator's
// call, refused while it holds work that exists nowhere else unless they say to discard it.

export interface ArchiveParams {
  session: string;
  removeWorktree?: boolean;
  deleteBranch?: boolean;
  discard?: boolean;
}

type Ctx = Pick<
  HandlerContext,
  'sessions' | 'git' | 'log' | 'closeSupervisor' | 'forgetAgentSession'
>;

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

// What removing the worktree would lose: files not committed, commits not pushed.
const refuseDirty = async (ctx: Ctx, record: SessionRecord): Promise<void> => {
  const [files, commits] = await Promise.all([
    ctx.git.status(record.worktree),
    ctx.git.unpushed(record.worktree, record.base),
  ]);
  if (files.length === 0 && commits === 0) return;
  const parts = [
    ...(files.length === 0 ? [] : [plural(files.length, 'uncommitted file')]),
    ...(commits === 0 ? [] : [plural(commits, 'unpushed commit')]),
  ];
  throw new DaemonError('dirty', `worktree has ${parts.join(' and ')}`);
};

// A worktree already gone (removed by hand) has nothing to check or remove; the branch can
// still be deleted.
const removeWorktree = async (ctx: Ctx, record: SessionRecord, discard: boolean): Promise<void> => {
  if (!(await exists(record.worktree))) return;
  if (!discard) await refuseDirty(ctx, record);
  await ctx.git.removeWorktree(record.repo, record.worktree, discard);
};

const archive = async (ctx: Ctx, params: ArchiveParams): Promise<Record<string, never>> => {
  const record = ctx.sessions.get(params.session);
  await ctx.closeSupervisor(record.session);
  if (params.removeWorktree === true) {
    await removeWorktree(ctx, record, params.discard === true);
    if (params.deleteBranch === true) await ctx.git.deleteBranch(record.repo, record.branch);
  }
  ctx.sessions.setArchived(record.session, true);
  ctx.forgetAgentSession(record.session);
  return {};
};

const unarchive = async (ctx: Ctx, session: string): Promise<Record<string, never>> => {
  const record = ctx.sessions.get(session);
  if (!(await exists(record.worktree))) {
    throw new DaemonError('not_found', `worktree ${record.worktree} is gone`);
  }
  ctx.sessions.setArchived(session, false);
  return {};
};

// The `/clear` of a terminal session: the agent and its context go, the worktree and the log
// stay. Open asks are settled before the marker so nothing before it is still waiting.
const clear = async (ctx: Ctx, session: string): Promise<Record<string, never>> => {
  ctx.sessions.get(session);
  await ctx.closeSupervisor(session);
  settleAsks(ctx.log, session);
  ctx.sessions.setAgentSessionId(session, null);
  ctx.forgetAgentSession(session);
  ctx.log.append(session, { type: 'session.cleared', payload: {} });
  return {};
};

export const sessionLifecycle: {
  archive: typeof archive;
  unarchive: typeof unarchive;
  clear: typeof clear;
} = { archive, unarchive, clear };
