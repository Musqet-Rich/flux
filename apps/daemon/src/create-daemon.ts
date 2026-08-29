import type { FluxEvent } from '@flux/protocol';

import type { AttachedControl } from './attach-control.ts';
import { attachControl } from './attach-control.ts';
import { connectRelay } from './connect-relay.ts';
import type { HostTransport, TransportStatus } from './create-host-transport.ts';
import { createMcpConfig } from './create-mcp-config.ts';
import type { NotifierOptions } from './create-notifier.ts';
import { createNotifier } from './create-notifier.ts';
import type { PairingGate } from './create-pairing-gate.ts';
import { createPairingGate } from './create-pairing-gate.ts';
import { createRpcHandlers } from './create-rpc-handlers.ts';
import type { SupervisorPool } from './create-supervisor-pool.ts';
import { createSupervisorPool } from './create-supervisor-pool.ts';
import type { Services, ServicesOptions } from './open-services.ts';
import { openServices } from './open-services.ts';

// Composition root: wires the stores, the git service, the session supervisors, the device
// channels and the relay transport together (architecture.md § Daemon).

export interface DaemonConfig {
  dataDir: string;
  relayUrl: string;
  reposDir: string;
  daemonName: string;
  // VAPID subject (RFC 8292), a mailto: or https: URL the push services may contact.
  pushSubject: string;
  claudeCommand?: string;
  // The flux user's `~/.claude`; the PWA edits CLAUDE.md and settings.json there.
  claudeDir: string;
}

export interface Daemon {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  pairingUrl: () => string;
  devices: Services['devices']['devices'];
  // Revokes a device: trust, push subscriptions and any live channel (`flux devices rm`).
  removeDevice: (deviceId: string) => Promise<void>;
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

// Store first so a device that is already gone from trust cannot re-handshake while its channel
// is being told; then push, then the channel.
const revoker =
  (services: Services, transport: () => HostTransport) =>
  async (deviceId: string): Promise<void> => {
    services.devices.remove(deviceId);
    services.push.removeDevice(deviceId);
    await transport().revoke(deviceId);
  };

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
  removeDevice: revoker(services, () => transport),
  status: transport.status,
  controlSocket: control.path,
});

const servicesOptions = (config: DaemonConfig): ServicesOptions => ({
  dataDir: config.dataDir,
  claudeDir: config.claudeDir,
  reposDir: config.reposDir,
});

// Which push triggers the operator has left on; read per event so a change applies at once.
const notifyEnabled =
  (services: Services): NonNullable<NotifierOptions['enabled']> =>
  (kind) => {
    const flux = services.settings.get();
    if (kind === 'ask') return flux.notifyOnAsk;
    return kind === 'idle' ? flux.notifyOnIdle : flux.notifyOnDone;
  };

const env = (config: DaemonConfig) => ({
  relayUrl: config.relayUrl,
  dataDir: config.dataDir,
  daemonName: config.daemonName,
  pushSubject: config.pushSubject,
  claudeCommand: config.claudeCommand ?? 'claude',
});

export const createDaemon = async (config: DaemonConfig): Promise<Daemon> => {
  const { dataDir } = config;
  const services = openServices(servicesOptions(config));
  const identity = await services.devices.identity();
  const { relayUrl, pushSubject: subject } = config;
  const gate = createPairingGate({ relayUrl, boxPub: identity.publicKey, ...services });
  const { push } = services;
  const notifier = await createNotifier({ push, subject, enabled: notifyEnabled(services) });
  // Transport and supervisors are created below; nothing calls these before start.
  const emit = (event: FluxEvent): void => {
    void transport.broadcast({ kind: 'event', event });
    void notifier.notify(event);
  };
  const control = attachControl({
    ...services,
    dataDir,
    supervisor: (record) => supervisors.get(record),
    emit,
    pairingUrl: gate.url,
    revokeDevice: revoker(services, () => transport),
  });
  const supervisors = createSupervisorPool({
    ...services,
    mcpConfig: createMcpConfig({ dataDir, controlSocket: control.path }),
    ...(config.claudeCommand === undefined ? {} : { claudeCommand: config.claudeCommand }),
    emit,
    emitEphemeral: (data) => void transport.broadcast({ kind: 'ephemeral', data }),
  });
  const handlers = createRpcHandlers(
    {
      ...services,
      daemonName: config.daemonName,
      vapidPublicKey: notifier.vapidPublicKey,
      env: env(config),
      supervisor: supervisors.get,
      closeSupervisor: supervisors.close,
      revokeDevice: revoker(services, () => transport),
    },
    emit,
  );
  const transport = await connectRelay({
    relayUrl: config.relayUrl,
    identity,
    deviceByKey: services.devices.deviceByKey,
    pairingOpen: gate.open,
    handlers,
  });
  return assemble({ services, supervisors, transport, control, gate });
};
