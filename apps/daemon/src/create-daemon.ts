import { pairing } from '@flux/protocol';

import { connectRelay } from './connect-relay.ts';
import type { Device } from './create-device-store.ts';
import type { TransportStatus } from './create-host-transport.ts';
import { createRpcHandlers } from './create-rpc-handlers.ts';
import { createSupervisorPool } from './create-supervisor-pool.ts';
import { openServices } from './open-services.ts';

// Composition root: wires the stores, the git service, the session supervisors, the device
// channels and the relay transport together (architecture.md § Daemon).

export interface DaemonConfig {
  dataDir: string;
  relayUrl: string;
  reposDir: string;
  daemonName: string;
  claudeCommand?: string;
}

export interface Daemon {
  start: () => void;
  stop: () => Promise<void>;
  pairingUrl: () => string;
  devices: () => Device[];
  removeDevice: (deviceId: string) => void;
  status: () => TransportStatus;
}

const pairingWindowMs = 10 * 60 * 1000;

export const createDaemon = async (config: DaemonConfig): Promise<Daemon> => {
  const services = openServices(config.dataDir);
  const identity = await services.devices.identity();
  let pairingUntil = 0;
  const supervisors = createSupervisorPool({
    log: services.log,
    sessions: services.sessions,
    git: services.git,
    ...(config.claudeCommand === undefined ? {} : { claudeCommand: config.claudeCommand }),
    // The transport is created below; supervisors only emit after start, by which time it exists.
    emit: (event) => void transport.broadcast({ kind: 'event', event }),
    emitEphemeral: (data) => void transport.broadcast({ kind: 'ephemeral', data }),
  });
  const handlers = createRpcHandlers({
    ...services,
    daemonName: config.daemonName,
    reposDir: config.reposDir,
    supervisor: supervisors.get,
    closeSupervisor: supervisors.close,
  });
  const transport = await connectRelay({
    relayUrl: config.relayUrl,
    identity,
    deviceByKey: services.devices.deviceByKey,
    pairingOpen: () => Date.now() < pairingUntil,
    handlers,
  });
  return {
    start: transport.start,
    stop: async () => {
      transport.stop();
      await supervisors.closeAll();
      services.close();
    },
    pairingUrl: () => {
      pairingUntil = Date.now() + pairingWindowMs;
      const secret = services.devices.newSecret();
      return pairing.url(config.relayUrl, { boxPub: identity.publicKey, secret });
    },
    devices: services.devices.devices,
    removeDevice: services.devices.remove,
    status: transport.status,
  };
};
