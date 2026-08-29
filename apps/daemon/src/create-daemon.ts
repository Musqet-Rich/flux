import type { FluxEvent } from '@flux/protocol';

import type { AttachedControl } from './attach-control.ts';
import { attachControl } from './attach-control.ts';
import { connectRelay } from './connect-relay.ts';
import type { Device } from './create-device-store.ts';
import type { HostTransport, TransportStatus } from './create-host-transport.ts';
import { createMcpConfig } from './create-mcp-config.ts';
import type { PairingGate } from './create-pairing-gate.ts';
import { createPairingGate } from './create-pairing-gate.ts';
import { createRpcHandlers } from './create-rpc-handlers.ts';
import type { SupervisorPool } from './create-supervisor-pool.ts';
import { createSupervisorPool } from './create-supervisor-pool.ts';
import type { Services } from './open-services.ts';
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
  start: () => Promise<void>;
  stop: () => Promise<void>;
  pairingUrl: () => string;
  devices: () => Device[];
  removeDevice: (deviceId: string) => void;
  status: () => TransportStatus;
  controlSocket: string;
}

interface Parts {
  services: Services;
  supervisors: SupervisorPool;
  transport: HostTransport;
  control: AttachedControl;
  gate: PairingGate;
}

const assemble = ({ services, supervisors, transport, control, gate }: Parts): Daemon => ({
  start: () => control.listen().then(transport.start),
  stop: async () => {
    transport.stop();
    await control.close();
    await supervisors.closeAll();
    services.close();
  },
  pairingUrl: gate.url,
  devices: services.devices.devices,
  removeDevice: services.devices.remove,
  status: transport.status,
  controlSocket: control.path,
});

export const createDaemon = async (config: DaemonConfig): Promise<Daemon> => {
  const services = openServices(config.dataDir);
  const identity = await services.devices.identity();
  const gate = createPairingGate({
    relayUrl: config.relayUrl,
    boxPub: identity.publicKey,
    ...services,
  });
  // Transport and supervisors are created below; nothing calls these before start.
  const emit = (event: FluxEvent): void => void transport.broadcast({ kind: 'event', event });
  const control = attachControl({
    ...services,
    dataDir: config.dataDir,
    supervisor: (record) => supervisors.get(record),
    emit,
    pairingUrl: gate.url,
  });
  const supervisors = createSupervisorPool({
    log: services.log,
    sessions: services.sessions,
    git: services.git,
    mcpConfig: createMcpConfig({ dataDir: config.dataDir, controlSocket: control.path }),
    ...(config.claudeCommand === undefined ? {} : { claudeCommand: config.claudeCommand }),
    emit,
    emitEphemeral: (data) => void transport.broadcast({ kind: 'ephemeral', data }),
  });
  const { daemonName, reposDir } = config;
  const { get: supervisor, close: closeSupervisor } = supervisors;
  const handlers = createRpcHandlers({
    ...services,
    daemonName,
    reposDir,
    supervisor,
    closeSupervisor,
  });
  const transport = await connectRelay({
    relayUrl: config.relayUrl,
    identity,
    deviceByKey: services.devices.deviceByKey,
    pairingOpen: gate.open,
    handlers,
  });
  return assemble({ services, supervisors, transport, control, gate });
};
