import type { AgentKind, FluxEvent } from '@flux/protocol';

import { createAgentCommands } from './create-agent-commands.ts';
import type { AttachedControl } from './attach-control.ts';
import { attachControl } from './attach-control.ts';
import type { HostTransport, TransportStatus } from './connect-relay.ts';
import { connectRelay } from './connect-relay.ts';
import { createUpdateService } from './create-update-service.ts';
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
  piCommand?: string;
  // pi's `--provider` / `--model`; unset, pi uses its own settings.json defaults.
  piProvider?: string;
  piModel?: string;
  // The flux user's `~/.claude`; the PWA edits CLAUDE.md and settings.json there.
  claudeDir: string;
  // How patiently each agent is closed on stop, per stage (close-child.ts).
  closeGraceMs?: number;
  // The installed bundle directory (siblings of the running index.mjs), or null when run from
  // source (ADR 0022); self-update is refused on a dev build. index.ts detects it from argv.
  distDir?: string | null;
  // Release repo slug for self-update fetches (`FLUX_RELEASE_REPO`); defaults inside fetchRelease.
  releaseRepo?: string;
}

export interface Daemon {
  // Takes the data dir lock (`conflict` if another daemon holds it), settles what the last
  // daemon left behind, binds the control socket, connects to the relay.
  start: () => Promise<ReturnType<Services['settle']>>;
  // Bounded (ADR 0017): asks abort, control connections drop, agents are closed with
  // escalation, then the stores close and the lock is released.
  stop: () => Promise<void>;
  // For a shutdown that cannot wait for `stop` (a second signal, its budget spent): every
  // agent's process group is SIGKILLed and the lock released, synchronously.
  abandon: () => void;
  pairingUrl: () => string;
  devices: Services['devices']['devices'];
  // Revokes a device: trust, push subscriptions and any live channel (`flux devices rm`).
  removeDevice: (deviceId: string) => Promise<void>;
  status: () => TransportStatus;
  controlSocket: string;
  agents: AgentKind[];
}

interface Parts {
  services: Services;
  supervisors: SupervisorPool;
  transport: HostTransport;
  control: AttachedControl;
  gate: PairingGate;
  agents: AgentKind[];
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

const assemble = ({ services, supervisors, transport, control, gate, agents }: Parts): Daemon => {
  let lock: ReturnType<Services['lock']> | null = null;
  let stopped = false;
  return {
    start: async () => {
      lock = services.lock();
      try {
        const settled = services.settle();
        await control.listen();
        transport.start();
        return settled;
      } catch (error) {
        lock.release();
        lock = null;
        throw error;
      }
    },
    // Idempotent: a signal and a caller can both ask for it, and the second is a no-op.
    stop: async () => {
      if (stopped) return;
      stopped = true;
      transport.stop();
      services.asks.close();
      // The aborted answers reach the control handlers on later microtasks; let them log
      // `ask.answered` and reply, so an agent blocked in flux_ask gets its tool result and can
      // leave on stdin EOF, before the connections are destroyed.
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      await control.close();
      await supervisors.closeAll();
      services.close();
      lock?.release();
      lock = null;
    },
    abandon: () => {
      supervisors.killAll();
      lock?.release();
      lock = null;
    },
    pairingUrl: gate.url,
    devices: services.devices.devices,
    removeDevice: revoker(services, () => transport),
    status: transport.status,
    controlSocket: control.path,
    agents,
  };
};

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

// Events go to every device and to the notifier; transport exists by the time anything emits.
const emitter =
  (notifier: { notify: (event: FluxEvent) => Promise<void> }, transport: () => HostTransport) =>
  (event: FluxEvent): void => {
    void transport().broadcast({ kind: 'event', event });
    void notifier.notify(event);
  };

interface ContextExtra {
  notifier: { vapidPublicKey: string };
  agents: AgentKind[];
  supervisors: SupervisorPool;
  forget: (session: string) => void;
  revokeDevice: (deviceId: string) => Promise<void>;
  update: ReturnType<typeof createUpdateService>;
}

// The handler context (handler-context.ts): the stores plus the daemon-level services an RPC
// handler may touch. Built here so the composition root stays short.
const daemonContext = (services: Services, config: DaemonConfig, extra: ContextExtra) => ({
  ...services,
  daemonName: config.daemonName,
  vapidPublicKey: extra.notifier.vapidPublicKey,
  env: env(config),
  agents: extra.agents,
  supervisor: extra.supervisors.get,
  closeSupervisor: extra.supervisors.close,
  forgetAgentSession: extra.forget,
  revokeDevice: extra.revokeDevice,
  update: extra.update,
});

export const createDaemon = async (config: DaemonConfig): Promise<Daemon> => {
  const { dataDir, relayUrl, pushSubject: subject } = config;
  const services = openServices(servicesOptions(config));
  const identity = await services.devices.identity();
  const gate = createPairingGate({ relayUrl, boxPub: identity.publicKey, ...services });
  const { push } = services;
  const notifier = await createNotifier({ push, subject, enabled: notifyEnabled(services) });
  const emit = emitter(notifier, () => transport);
  const control = attachControl({
    ...services,
    dataDir,
    supervisor: (record) => supervisors.get(record),
    emit,
    pairingUrl: gate.url,
    revokeDevice: revoker(services, () => transport),
  });
  const { agents, pool, forget } = createAgentCommands({ ...config, controlSocket: control.path });
  const supervisors = createSupervisorPool({
    ...services,
    ...pool,
    emit,
    emitEphemeral: (data) => void transport.broadcast({ kind: 'ephemeral', data }),
    ...(config.closeGraceMs === undefined ? {} : { closeGraceMs: config.closeGraceMs }),
  });
  const update = createUpdateService(
    config,
    dataDir,
    () => transport,
    () => daemon.stop(),
  );
  const ctx = daemonContext(services, config, {
    notifier,
    agents,
    supervisors,
    forget,
    revokeDevice: revoker(services, () => transport),
    update,
  });
  const handlers = createRpcHandlers(ctx, emit);
  const transport = await connectRelay({
    relayUrl: config.relayUrl,
    identity,
    deviceByKey: services.devices.deviceByKey,
    pairingOpen: gate.open,
    handlers,
  });
  const daemon = assemble({ services, supervisors, transport, control, gate, agents });
  return daemon;
};
