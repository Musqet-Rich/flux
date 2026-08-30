import type { RpcMethods } from '@flux/protocol';
import { semver } from '@flux/protocol';

import type { Peer } from './create-device-channels.ts';
import { DaemonError } from './daemon-error.ts';
import type { HandlerContext, UpdateService } from './handler-context.ts';

// The `daemon.update` method (ADR 0022 § 4): validate the target against the running version with
// the shared semver and refuse anything the daemon will not install with `unsupported` — an
// invalid version, one below the 1.0.0 floor, one not strictly newer than the running build
// (same-version `already_current` folds into this), or a dev build run from source. Otherwise it
// answers an empty result at once and kicks off the async fetch, verify, swap and exit; progress
// and failure arrive as the `update.progress` / `update.failed` ephemerals, not in this result.
// The PWA passes its own version as the target.

export type UpdateHandlers = Pick<
  {
    [M in keyof RpcMethods]: (
      params: RpcMethods[M]['params'],
      peer: Peer,
    ) => Promise<RpcMethods[M]['result']>;
  },
  'daemon.update'
>;

// The compat floor: self-update never installs a pre-1.0 build (ADR 0022 § 4).
const floor = '1.0.0';

const check = (update: UpdateService, target: string): void => {
  if (update.distDir === null) {
    throw new DaemonError('unsupported', 'this daemon runs from source and cannot self-update');
  }
  if (!semver.isValid(target)) {
    throw new DaemonError('unsupported', `not a valid version: ${target}`);
  }
  if (!semver.atLeast(target, floor)) {
    throw new DaemonError('unsupported', `below the ${floor} update floor: ${target}`);
  }
  if (!semver.isNewer(target, update.currentVersion)) {
    throw new DaemonError('unsupported', `not newer than the running ${update.currentVersion}`);
  }
};

export const createUpdateHandlers = (ctx: HandlerContext): UpdateHandlers => ({
  'daemon.update': (params) => {
    check(ctx.update, params.version);
    ctx.update.apply(params.version);
    return Promise.resolve({});
  },
});
