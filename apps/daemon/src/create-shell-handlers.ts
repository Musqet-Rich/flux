import type { RpcMethods } from '@flux/protocol';

import type { Peer } from './create-device-channels.ts';
import { DaemonError } from './daemon-error.ts';
import type { HandlerContext } from './handler-context.ts';

// The operator command-runner methods (ADR 0026), reachable only by a paired device and never
// exposed as an agent tool. Both key their run to the caller's device: `shell.run` refuses a
// second concurrent run per device (`conflict`), and `shell.interrupt` only ever touches this
// device's own run (`not_found` otherwise), so no device can see or kill another's run.

export type ShellHandlers = Pick<
  {
    [M in keyof RpcMethods]: (
      params: RpcMethods[M]['params'],
      peer: Peer,
    ) => Promise<RpcMethods[M]['result']>;
  },
  'shell.run' | 'shell.interrupt'
>;

// The router gates every method but `pair.request` behind pairing, so a shell peer always has a
// device; this is the defensive floor should that ever change.
const deviceOf = (peer: Peer): string => {
  if (peer.device === null) throw new DaemonError('not_paired', 'pair this device first');
  return peer.device.deviceId;
};

export const createShellHandlers = (ctx: HandlerContext): ShellHandlers => ({
  'shell.run': (params, peer) => {
    const deviceId = deviceOf(peer);
    const cwd = params.cwd;
    return Promise.resolve(
      ctx.shell.run({ command: params.command, deviceId, ...(cwd === undefined ? {} : { cwd }) }),
    );
  },
  'shell.interrupt': (params, peer) => {
    ctx.shell.interrupt({ runId: params.runId, deviceId: deviceOf(peer) });
    return Promise.resolve({});
  },
});
