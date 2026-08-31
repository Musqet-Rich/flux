import { room } from '@flux/protocol';

import { createDeviceChannels } from './create-device-channels.ts';
import type { BoxIdentity, Device } from './create-device-store.ts';
import type { HostTransport } from './create-host-transport.ts';
import { createHostTransport } from './create-host-transport.ts';
import type { RpcHandlers } from './create-rpc-router.ts';
import { createRpcRouter } from './create-rpc-router.ts';

// The box's link to its devices: room derivations, per-device channels, RPC routing and the
// relay transport, assembled in one place so the composition root stays readable.

// The composition root talks to the transport through this module, so the transport's shape
// travels with `connectRelay` rather than as a second import of `create-host-transport`.
export type { HostTransport, TransportStatus } from './create-host-transport.ts';

// The command runner (ADR 0026) is re-exported here because its lifecycle is wired through this
// module's device-channel teardown (`onDeviceGone`), and so the composition root reaches it
// through a module it already imports, keeping create-daemon.ts within its dependency budget.
export type { ShellRunner } from './create-shell-runner.ts';
export { createShellRunner } from './create-shell-runner.ts';

export interface ConnectRelayOptions {
  relayUrl: string;
  identity: BoxIdentity;
  deviceByKey: (publicKey: Uint8Array<ArrayBuffer>) => Device | null;
  pairingOpen: () => boolean;
  handlers: RpcHandlers;
  // A paired device lost its last channel (ADR 0026): the command runner kills its active run.
  onDeviceGone?: (deviceId: string) => void;
}

export const connectRelay = async (options: ConnectRelayOptions): Promise<HostTransport> => {
  const roomId = await room.id(options.identity.publicKey);
  const token = await room.token(options.identity.publicKey);
  const channels = createDeviceChannels({
    identity: options.identity,
    deviceByKey: options.deviceByKey,
    pairingOpen: options.pairingOpen,
    onMessage: createRpcRouter(options.handlers),
    ...(options.onDeviceGone === undefined ? {} : { onDeviceGone: options.onDeviceGone }),
  });
  return createHostTransport({ relayUrl: options.relayUrl, roomId, token, channels });
};
