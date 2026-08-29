import type { RpcMethods } from '@flux/protocol';
import { base64url } from '@flux/protocol';
import { readdir } from 'node:fs/promises';

import type { Peer } from './create-device-channels.ts';
import { DaemonError } from './daemon-error.ts';
import type { HandlerContext } from './handler-context.ts';
import { inside } from './inside.ts';

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
  | 'fs.read'
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

const listDir = async (worktree: string, path: string) => {
  const entries = await readdir(inside(worktree, path), { withFileTypes: true });
  return entries
    .filter((e) => e.name !== '.git')
    .map((e) => ({ name: e.name, kind: e.isDirectory() ? ('dir' as const) : ('file' as const) }));
};

export const createRepoHandlers = (ctx: HandlerContext): RepoHandlers => {
  const worktreeOf = (session: string): { worktree: string; base: string } =>
    ctx.sessions.get(session);
  return {
    'git.status': async (p) => ({ files: await ctx.git.status(worktreeOf(p.session).worktree) }),
    'git.diff': async (p) => {
      const record = worktreeOf(p.session);
      return { diff: await ctx.git.diff(record.worktree, record.base, diffOptions(p)) };
    },
    'git.show': (p) => ctx.git.show(worktreeOf(p.session).worktree, p.path, p.rev),
    'git.log': async (p) => ({
      commits: await ctx.git.log(worktreeOf(p.session).worktree, p.limit ?? 50),
    }),
    'fs.read': (p) => {
      const { worktree } = worktreeOf(p.session);
      const relative = inside(worktree, p.path).slice(worktree.length + 1);
      return ctx.git.show(worktree, relative, 'worktree');
    },
    'fs.list': async (p) => ({ entries: await listDir(worktreeOf(p.session).worktree, p.path) }),
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
