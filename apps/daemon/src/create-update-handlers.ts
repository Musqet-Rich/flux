import type { RpcMethods } from '@flux/protocol';
import { semver } from '@flux/protocol';

import type { Peer } from './create-device-channels.ts';
import { DaemonError } from './daemon-error.ts';
import type { HandlerContext, UpdateService } from './handler-context.ts';
import type { Eligibility } from './update/update-eligibility.ts';
import { updateEligibility } from './update/update-eligibility.ts';

// The self-update methods (ADR 0021/0022 § 4). `daemon.update` validates the target against the
// running version with the shared `updateEligibility` predicate and refuses anything the daemon
// will not install with `unsupported` — an invalid version, one below the 1.0.0 floor, one not
// strictly newer than the running build (same-version `already_current` folds into this), or a
// dev build run from source. Otherwise it answers `{}` at once and kicks off the async fetch,
// verify, swap and exit; progress and failure arrive as the `update.progress` / `update.failed`
// ephemerals, not in this result. `daemon.checkUpdate` discovers the newest release and dry-run
// verifies it WITHOUT applying, so the box learns it is behind and proves a release before
// running it. The PWA passes its own version as the update target.

export type UpdateHandlers = Pick<
  {
    [M in keyof RpcMethods]: (
      params: RpcMethods[M]['params'],
      peer: Peer,
    ) => Promise<RpcMethods[M]['result']>;
  },
  'daemon.update' | 'daemon.checkUpdate'
>;

type NotOk = Extract<Eligibility, { ok: false }>['reason'];

const refusal = (reason: NotOk, target: string, current: string): string =>
  reason === 'source_build'
    ? 'this daemon runs from source and cannot self-update'
    : reason === 'below_floor'
      ? `below the 1.0.0 update floor: ${target}`
      : `not newer than the running ${current}`;

const check = (update: UpdateService, target: string): void => {
  if (!semver.isValid(target)) {
    throw new DaemonError('unsupported', `not a valid version: ${target}`);
  }
  const eligible = updateEligibility({
    distDir: update.distDir,
    current: update.currentVersion,
    target,
  });
  if (!eligible.ok) {
    throw new DaemonError('unsupported', refusal(eligible.reason, target, update.currentVersion));
  }
};

export const createUpdateHandlers = (ctx: HandlerContext): UpdateHandlers => ({
  'daemon.update': (params) => {
    check(ctx.update, params.version);
    ctx.update.apply(params.version);
    return Promise.resolve({});
  },
  'daemon.checkUpdate': () => ctx.update.check(),
});
