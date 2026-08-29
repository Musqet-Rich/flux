import type { RpcMethods } from '@flux/protocol';
import { base64url } from '@flux/protocol';
import { readdir } from 'node:fs/promises';

import type { Peer } from './create-device-channels.ts';
import { DaemonError } from './daemon-error.ts';
import { fileContent } from './file-content.ts';
import type { HandlerContext } from './handler-context.ts';
import { realInside } from './real-inside.ts';

// Git, file, repository, pairing and push methods of protocol.md § 7.

export type RepoHandlers = Pick<
  {
    [M in keyof RpcMethods]: (
      params: RpcMethods[M]['params'],
      peer: Peer,
    ) => Promise<RpcMethods[M]['result']>;
  },
  | 'git.status'
  | 'git.diff'
  | 'git.show'
  | 'git.log'
  | 'git.commit'
  | 'git.push'
  | 'git.pr'
  | 'fs.read'
  | 'fs.write'
  | 'fs.list'
  | 'repos.list'
  | 'pair.request'
  | 'push.subscribe'
>;

const diffOptions = (p: { path?: string; from?: string; to?: string }) => ({
  ...(p.path === undefined ? {} : { path: p.path }),
  ...(p.from === undefined ? {} : { from: p.from }),
  ...(p.to === undefined ? {} : { to: p.to }),
});

const prOptions = (
  p: { title: string; body?: string; base?: string; draft?: boolean },
  base: string | undefined,
) => ({
  title: p.title,
  ...(p.body === undefined ? {} : { body: p.body }),
  ...(base === undefined ? {} : { base }),
  ...(p.draft === undefined ? {} : { draft: p.draft }),
});

// The PR's base branch: the caller's, else the session's base when that is a branch of the
// repository (it is usually a commit, in which case gh picks the repository's default branch).
const prBase = async (
  ctx: HandlerContext,
  record: { repo: string; base: string },
  base: string | undefined,
): Promise<string | undefined> => {
  if (base !== undefined) return base;
  const branches = await ctx.git.branches(record.repo);
  return branches.includes(record.base) ? record.base : undefined;
};

// Every worktree path a device names is resolved through its symlinks and must stay inside.
const listDir = async (worktree: string, path: string) => {
  const { real } = await realInside(worktree, path);
  const entries = await readdir(real, { withFileTypes: true });
  return entries
    .filter((e) => e.name !== '.git')
    .map((e) => ({ name: e.name, kind: e.isDirectory() ? ('dir' as const) : ('file' as const) }));
};

type WorktreeOf = (session: string) => { worktree: string; base: string };

// The worktree file methods. Every path a device names is resolved through its symlinks and
// must stay inside the worktree; `git.show` at a rev is git's own lookup and needs no path check.
const fileHandlers = (
  ctx: HandlerContext,
  worktreeOf: WorktreeOf,
): Pick<RepoHandlers, 'git.show' | 'fs.read' | 'fs.write' | 'fs.list'> => ({
  'git.show': async (p) => {
    const { worktree } = worktreeOf(p.session);
    if (p.rev !== 'worktree') return ctx.git.show(worktree, p.path, p.rev);
    const { real } = await realInside(worktree, p.path);
    return fileContent.read(real);
  },
  'fs.read': async (p) => {
    const { real } = await realInside(worktreeOf(p.session).worktree, p.path);
    return fileContent.read(real);
  },
  'fs.write': async (p) => {
    const { real } = await realInside(worktreeOf(p.session).worktree, p.path);
    return { hash: await fileContent.write(real, p.content, p.ifMatch ?? null) };
  },
  'fs.list': async (p) => ({ entries: await listDir(worktreeOf(p.session).worktree, p.path) }),
});

export const createRepoHandlers = (ctx: HandlerContext): RepoHandlers => {
  const worktreeOf: WorktreeOf = (session) => ctx.sessions.get(session);
  return {
    'git.status': async (p) => ({ files: await ctx.git.status(worktreeOf(p.session).worktree) }),
    'git.diff': async (p) => {
      const record = worktreeOf(p.session);
      return { diff: await ctx.git.diff(record.worktree, record.base, diffOptions(p)) };
    },
    'git.log': async (p) => ({
      commits: await ctx.git.log(worktreeOf(p.session).worktree, p.limit ?? 50),
    }),
    'git.commit': async (p) => ({
      sha: await ctx.git.commit(worktreeOf(p.session).worktree, p.message, p.paths),
    }),
    'git.push': (p) => ctx.git.push(worktreeOf(p.session).worktree, p.setUpstream === true),
    'git.pr': async (p) => {
      const record = ctx.sessions.get(p.session);
      const base = await prBase(ctx, record, p.base);
      return { url: await ctx.git.pr(record.worktree, prOptions(p, base)) };
    },
    ...fileHandlers(ctx, worktreeOf),
    'repos.list': async () => ({ repos: await ctx.git.listRepos(ctx.reposDir) }),
    'pair.request': async (p, peer) => {
      const devPub = base64url.decode(p.devPub);
      const device = await ctx.devices.pair(devPub, base64url.decode(p.proof), 'device');
      if (device === null) throw new DaemonError('not_paired', 'pairing failed');
      peer.device = device;
      return { deviceId: device.deviceId };
    },
    'push.subscribe': (p, peer) => {
      if (peer.device === null) throw new DaemonError('not_paired', 'pair this device first');
      try {
        ctx.push.put(peer.device.deviceId, p.subscription);
      } catch {
        throw new DaemonError('bad_params', 'not a push subscription');
      }
      return Promise.resolve({});
    },
  };
};
