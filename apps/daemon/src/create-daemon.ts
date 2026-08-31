import type { Ephemeral, FluxEvent, HarnessKind } from '@flux/protocol';

import { createAgentCommands } from './create-agent-commands.ts';
import type { AttachedControl } from './attach-control.ts';
import { attachControl } from './attach-control.ts';
import type { HostTransport, ShellRunner, TransportStatus } from './connect-relay.ts';
import { connectRelay, createShellRunner } from './connect-relay.ts';
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

// Re-exported so the CLI (index.ts) reaches the install-dir detector through the daemon module it
// already imports, keeping index.ts within its dependency budget; `distDir` is a DaemonConfig
// field, so the detector belongs to this module's surface. `runHelp` (the `flux help` seam) rides
// the same channel: pure bundled text, no daemon, but routed here so index.ts stays within budget.
export { detectDistDir } from './update/detect-dist-dir.ts';
export { runHelp } from './help/run-help.ts';

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
  // The opencode binary (`FLUX_OPENCODE`), default `opencode` on PATH (ADR 0027); absent is fine,
  // opencode simply does not appear in `hello.agents` and cannot be picked.
  opencodeCommand?: string;
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
  agents: HarnessKind[];
}

interface Parts {
  services: Services;
  supervisors: SupervisorPool;
  transport: HostTransport;
  control: AttachedControl;
  gate: PairingGate;
  agents: HarnessKind[];
  shell: ShellRunner;
}

// Store first so a device that is already gone from trust cannot re-handshake while its channel
// is being told; then push, kill any command it was running (ADR 0026, no orphans), then the
// channel.
const revoker =
  (services: Services, transport: () => HostTransport, shell: ShellRunner) =>
  async (deviceId: string): Promise<void> => {
    services.devices.remove(deviceId);
    services.push.removeDevice(deviceId);
    shell.disconnect(deviceId);
    await transport().revoke(deviceId);
  };

interface DaemonState {
  lock: ReturnType<Services['lock']> | null;
  stopped: boolean;
}

const startDaemon = async (parts: Parts, state: DaemonState) => {
  state.lock = parts.services.lock();
  try {
    // First-run seed of the default Agents (Help); idempotent, daemon-only (ADR 0008).
    parts.services.settings.seedDefaults();
    const settled = parts.services.settle();
    await parts.control.listen();
    parts.transport.start();
    return settled;
  } catch (error) {
    state.lock.release();
    state.lock = null;
    throw error;
  }
};

// Bounded shutdown (ADR 0017). Idempotent: a signal and a caller can both ask for it. `shell` is
// stopped first so no operator command outlives the daemon (ADR 0026). The `setImmediate` lets the
// aborted asks reach the control handlers and log `ask.answered` before the connections are torn
// down, so an agent blocked in flux_ask gets its tool result and can leave on stdin EOF.
const stopDaemon = async (parts: Parts, state: DaemonState): Promise<void> => {
  if (state.stopped) return;
  state.stopped = true;
  parts.shell.stopAll();
  parts.transport.stop();
  parts.services.asks.close();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  await parts.control.close();
  await parts.supervisors.closeAll();
  parts.services.close();
  state.lock?.release();
  state.lock = null;
};

const assemble = (parts: Parts): Daemon => {
  const { services, supervisors, transport, control, gate, agents, shell } = parts;
  const state: DaemonState = { lock: null, stopped: false };
  return {
    start: () => startDaemon(parts, state),
    stop: () => stopDaemon(parts, state),
    abandon: () => {
      shell.stopAll();
      supervisors.killAll();
      state.lock?.release();
      state.lock = null;
    },
    pairingUrl: gate.url,
    devices: services.devices.devices,
    removeDevice: revoker(services, () => transport, shell),
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

// The three fan-out sinks the composition root wires once: logged events to devices + notifier, the
// session-less ephemeral broadcast, and the command runner (ADR 0026) that broadcasts through it.
const signals = (
  notifier: { notify: (event: FluxEvent) => Promise<void> },
  transport: () => HostTransport,
  reposDir: string,
) => {
  const emitEphemeral = (data: Ephemeral): void =>
    void transport().broadcast({ kind: 'ephemeral', data });
  const shell = createShellRunner({ reposDir, emitEphemeral });
  return { emit: emitter(notifier, transport), emitEphemeral, shell };
};

// The session supervisor pool, with an optional close-grace override folded in (the object spread
// keeps `exactOptionalPropertyTypes` happy when the config leaves it unset).
const buildSupervisors = (
  services: Services,
  pool: ReturnType<typeof createAgentCommands>['pool'],
  emit: (event: FluxEvent) => void,
  emitEphemeral: (data: Ephemeral) => void,
  closeGraceMs: number | undefined,
): SupervisorPool =>
  createSupervisorPool({
    ...services,
    ...pool,
    emit,
    emitEphemeral,
    ...(closeGraceMs === undefined ? {} : { closeGraceMs }),
  });

interface ContextExtra {
  notifier: { vapidPublicKey: string };
  agents: HarnessKind[];
  supervisors: SupervisorPool;
  forget: (session: string) => void;
  revokeDevice: (deviceId: string) => Promise<void>;
  update: ReturnType<typeof createUpdateService>;
  shell: ShellRunner;
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
  shell: extra.shell,
});

export const createDaemon = async (config: DaemonConfig): Promise<Daemon> => {
  const { dataDir, relayUrl, pushSubject: subject } = config;
  const services = openServices(servicesOptions(config));
  const identity = await services.devices.identity();
  const gate = createPairingGate({ relayUrl, boxPub: identity.publicKey, ...services });
  const { push } = services;
  const notifier = await createNotifier({ push, subject, enabled: notifyEnabled(services) });
  const { emit, emitEphemeral, shell } = signals(notifier, () => transport, config.reposDir);
  const control = attachControl({
    ...services,
    dataDir,
    supervisor: (record) => supervisors.get(record),
    emit,
    pairingUrl: gate.url,
    revokeDevice: revoker(services, () => transport, shell),
    // A getter for `ctx` (declared below), so the manager ops (ADR 0025) resolve it lazily.
    ctx: () => ctx,
  });
  const { agents, pool, forget } = createAgentCommands({ ...config, controlSocket: control.path });
  const supervisors = buildSupervisors(services, pool, emit, emitEphemeral, config.closeGraceMs);
  const update = createUpdateService(
    config,
    () => transport,
    () => daemon.stop(),
  );
  const ctx = daemonContext(services, config, {
    notifier,
    agents,
    supervisors,
    forget,
    revokeDevice: revoker(services, () => transport, shell),
    update,
    shell,
  });
  const handlers = createRpcHandlers(ctx, emit);
  const transport = await connectRelay({
    relayUrl: config.relayUrl,
    identity,
    deviceByKey: services.devices.deviceByKey,
    pairingOpen: gate.open,
    handlers,
    onDeviceGone: shell.disconnect,
  });
  const daemon = assemble({ services, supervisors, transport, control, gate, agents, shell });
  return daemon;
};
