import { room } from '@flux/protocol';

import { createDeviceChannels } from './create-device-channels.ts';
import type { BoxIdentity, Device } from './create-device-store.ts';
import type { HostTransport } from './create-host-transport.ts';
import { createHostTransport } from './create-host-transport.ts';
import type { RpcHandlers } from './create-rpc-router.ts';
import { createRpcRouter } from './create-rpc-router.ts';

// The box's link to its devices: room derivations, per-device channels, RPC routing and the
// relay transport, assembled in one place so the composition root stays readable.

export interface ConnectRelayOptions {
  relayUrl: string;
  identity: BoxIdentity;
  deviceByKey: (publicKey: Uint8Array<ArrayBuffer>) => Device | null;
  pairingOpen: () => boolean;
  handlers: RpcHandlers;
}

export const connectRelay = async (options: ConnectRelayOptions): Promise<HostTransport> => {
  const roomId = await room.id(options.identity.publicKey);
  const token = await room.token(options.identity.publicKey);
  const channels = createDeviceChannels({
    identity: options.identity,
    deviceByKey: options.deviceByKey,
    pairingOpen: options.pairingOpen,
    onMessage: createRpcRouter(options.handlers),
  });
  return createHostTransport({ relayUrl: options.relayUrl, roomId, token, channels });
};
