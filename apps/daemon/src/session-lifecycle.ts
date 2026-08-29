import { access } from 'node:fs/promises';

import type { SessionRecord } from './create-session-store.ts';
import { DaemonError } from './daemon-error.ts';
import type { HandlerContext } from './handler-context.ts';
import { inside } from './inside.ts';
import { settleAsks } from './settle-asks.ts';

// Ending a session and coming back (protocol.md § 7: `sessions.archive`, `sessions.unarchive`,
// `sessions.clear`), and renaming it. Archiving always closes the agent; removing the worktree
// is the operator's call, refused while it holds work that exists nowhere else unless they say
// to discard it.

export interface ArchiveParams {
  session: string;
  removeWorktree?: boolean;
  deleteBranch?: boolean;
  discard?: boolean;
}

type Ctx = Pick<
  HandlerContext,
  'sessions' | 'git' | 'log' | 'asks' | 'worktreesDir' | 'closeSupervisor' | 'forgetAgentSession'
>;

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

// The agent goes on purpose. Its open asks are settled first, as aborted, so the answers are
// logged (by their control handlers) while the supervisor is still live and before anything
// this closing logs; the socket drop that follows the agent's exit then finds nothing pending.
// One turn of the event loop lets those handlers finish, as the daemon's own stop does.
const closeAgent = async (ctx: Ctx, session: string): Promise<void> => {
  settleAsks(ctx.log, session, ctx.asks.abort);
  await ctx.closeSupervisor(session);
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
};

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

// Only a worktree the daemon made (under its own directory) is ever removed: a row naming
// anything else, the repository itself above all, is refused before git sees it. A worktree
// already gone (removed by hand) has nothing to check; git is told, so the branch is free.
const removeWorktree = async (ctx: Ctx, record: SessionRecord, discard: boolean): Promise<void> => {
  inside(ctx.worktreesDir, record.worktree);
  if (!(await exists(record.worktree))) {
    await ctx.git.pruneWorktrees(record.repo);
    return;
  }
  if (!discard) await refuseDirty(ctx, record);
  await ctx.git.removeWorktree(record.repo, record.worktree, discard);
};

const archive = async (ctx: Ctx, params: ArchiveParams): Promise<Record<string, never>> => {
  const record = ctx.sessions.get(params.session);
  await closeAgent(ctx, record.session);
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
// stay. The id is forgotten before the close, so a send racing it already starts fresh, and
// again after, in case the closing agent reported one while it drained.
const clear = async (ctx: Ctx, session: string): Promise<Record<string, never>> => {
  ctx.sessions.get(session);
  ctx.sessions.setAgentSessionId(session, null);
  await closeAgent(ctx, session);
  ctx.sessions.setAgentSessionId(session, null);
  ctx.forgetAgentSession(session);
  ctx.log.append(session, { type: 'session.cleared', payload: {} });
  return {};
};

// The title is the tab's label and nothing else, so a rename touches only the row and the log,
// archived or not. Whitespace is trimmed; a title that is nothing but whitespace would leave a
// blank tab, and one longer than a tab could ever show is refused rather than logged forever.
const titleLimit = 200;

const rename = (ctx: Ctx, session: string, title: string): Record<string, never> => {
  ctx.sessions.get(session);
  const trimmed = title.trim();
  if (trimmed === '') throw new DaemonError('bad_params', 'title is empty');
  if (trimmed.length > titleLimit) {
    throw new DaemonError('bad_params', `title is longer than ${titleLimit} characters`);
  }
  ctx.sessions.setTitle(session, trimmed);
  ctx.log.append(session, { type: 'session.renamed', payload: { title: trimmed } });
  return {};
};

export const sessionLifecycle: {
  archive: typeof archive;
  unarchive: typeof unarchive;
  clear: typeof clear;
  rename: typeof rename;
} = { archive, unarchive, clear, rename };
