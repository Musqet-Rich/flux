import type { Ephemeral, FluxEvent, RpcMethods } from '@flux/protocol';
import { fluxEvent, guards, protocolVersion } from '@flux/protocol';

import { ClientError } from '../client/client-error.ts';
import type { Connection, ConnectionOptions } from '../client/create-connection.ts';
import type { SessionLog } from '../client/create-session-log.ts';
import { syncSession } from '../client/sync-session.ts';
import { deviceChoices } from './device-choices.ts';
import { logCache } from './log-cache.ts';
import type { Pairing } from './pairings.ts';
import { pairings } from './pairings.ts';
import { storeErrors } from './store-errors.ts';
import type { ErrorKind, LogView, StoreInternals } from './store-state.ts';

// The store's side of the connection (architecture.md § Sync model): what to do when the channel
// comes up, when an event or delta arrives, and when a call fails. Everything here mutates
// `i.state` and nothing else touches the connection.

type LinkOptions = Omit<ConnectionOptions, 'relayUrl' | 'keys' | 'boxPub'>;

const reportError = (i: StoreInternals, error: unknown, kind: ErrorKind = 'action'): void => {
  storeErrors.report(i, error, kind);
};
const clearError = storeErrors.clear;
const clearActionError = storeErrors.clearAction;

// The box says this device is no longer paired: the open daemon is forgotten (daemon-switch.ts),
// and another paired one opens with `reason` shown, or the app lands on the pair screen with it.
const unpair = (i: StoreInternals, reason: string): Promise<void> => i.forget(reason);

// Named, since with several daemons paired (ADR 0037) the one that let go may not be the one
// the app opens next.
const revokedReason = (i: StoreInternals): string =>
  `This device is no longer paired with ${i.state.daemon ?? i.pairing?.name ?? 'the daemon'}. Pair it again to continue.`;

const call = async <M extends keyof RpcMethods>(
  i: StoreInternals,
  method: M,
  params: RpcMethods[M]['params'],
): Promise<RpcMethods[M]['result']> => {
  if (i.connection === null) throw new ClientError('offline', 'not paired');
  try {
    return await i.connection.call(method, params);
  } catch (error) {
    // Only a box that has forgotten this device answers not_paired after pairing; the caller
    // reports the reason the pair screen shows, not the box's terse message.
    if (!(error instanceof ClientError) || error.code !== 'not_paired') throw error;
    const reason = revokedReason(i);
    await unpair(i, reason);
    throw new ClientError('not_paired', reason);
  }
};

// Runs an action for a view: a failure lands in `state.error` for the status bar and the view
// gets false, never a rejection to handle. A success takes a previous action's failure with it.
// A failure is shown only while the daemon it came from is still the open one: letting a
// daemon go stops its connection, which rejects what it had in flight with "stopped", and that
// is not news about the daemon opened instead (ADR 0037).
const reportFor = (
  i: StoreInternals,
  link: object | null,
  error: unknown,
  kind: ErrorKind = 'action',
): void => {
  if (i.link === link) reportError(i, error, kind);
};

const attempt = async (i: StoreInternals, action: () => Promise<unknown>): Promise<boolean> => {
  const link = i.link;
  try {
    await action();
    storeErrors.clearAction(i);
    return true;
  } catch (error) {
    reportFor(i, link, error);
    return false;
  }
};

// Pulls a log up to date; a no-op while offline because reconnecting syncs every open log.
const syncLog = async (i: StoreInternals, log: SessionLog): Promise<void> => {
  if (i.sync === null || i.connection?.status() !== 'connected') return;
  await i.sync(log);
  logCache.publish(i, log);
};

const refreshSessions = (i: StoreInternals): Promise<void> => {
  if (i.refreshing !== null) return i.refreshing;
  const link = i.link;
  const run = async (): Promise<void> => {
    try {
      const sessions = await call(i, 'sessions.list', {});
      if (i.link === link) i.state.sessions = sessions;
    } catch (error) {
      reportFor(i, link, error);
    } finally {
      i.refreshing = null;
    }
  };
  i.refreshing = run();
  return i.refreshing;
};

// Stores this device's push subscription on the box. Without `prompt` the browser is only asked
// for a subscription it can give silently (permission already granted); a tap on "Enable
// notifications" calls this with `prompt` so the permission dialog has a gesture behind it.
// `state.push` becomes `on` only once the box has the subscription, so a refusal is retried.
// Each daemon's subscription is on a service worker of its own (ADR 0037). The pairing carried
// over from before kept its subscription on the root worker; once its own is on the box, the old
// one is let go, so the box's next push to it finds it gone and drops it.
const enablePush = async (i: StoreInternals, prompt: boolean): Promise<boolean> => {
  const { subscribePush } = i.options;
  const key = i.vapidPublicKey;
  const { pairing, link } = i;
  if (i.state.push === 'on' || key === null || subscribePush === undefined) return false;
  if (pairing === null) return false;
  const subscription = await subscribePush(key, prompt, pairing.id);
  // Another daemon opened while the worker registered or the permission prompt waited: this
  // subscription is for the daemon let go, and must not be stored on the one now open.
  if (i.link !== link) return false;
  if (!guards.isRecord(subscription)) return false;
  await call(i, 'push.subscribe', { subscription });
  i.state.push = 'on';
  if (pairing.rootPush) await moveRootPush(i, pairing.id);
  return true;
};

// Best effort: a failed write is tried again on the next connect.
const savePairing = async (
  i: StoreInternals,
  id: string,
  change: Partial<Pick<Pairing, 'name' | 'rootPush'>>,
): Promise<void> => {
  await pairings
    .update(i.options.storage, (current) => ({
      ...current,
      entries: current.entries.map((e) => (e.id === id ? { ...e, ...change } : e)),
    }))
    .catch(() => null);
};

const moveRootPush = async (i: StoreInternals, id: string): Promise<void> => {
  await i.options.forgetPush?.(null).catch(() => null);
  if (i.pairing?.id === id) i.pairing.rootPush = false;
  await savePairing(i, id, { rootPush: false });
};

// The daemon's name names it in the picker, so a rename on the box shows on the next connect.
const recordName = async (i: StoreInternals, name: string): Promise<void> => {
  const pairing = i.pairing;
  if (pairing === null || pairing.name === name) return;
  pairing.name = name;
  const choice = i.state.daemons.find((d) => d.id === pairing.id);
  if (choice !== undefined) choice.name = name;
  await savePairing(i, pairing.id, { name });
};

const afterConnect = async (i: StoreInternals): Promise<void> => {
  const link = i.link;
  const hello = await call(i, 'hello', { protocol: protocolVersion });
  // Switched to another daemon while hello was on its way: this one's answer is not for screen.
  if (i.link !== link) return;
  i.state.daemon = hello.daemon;
  void recordName(i, hello.daemon);
  i.state.daemonVersion = hello.version ?? null;
  i.state.home = hello.home ?? null;
  // A self-update succeeded when the box comes back on the version we asked it to install: the
  // channel dropped on its exit, reconnect brought the new `hello.version`, so clear the banner.
  if (i.state.update.target !== null && hello.version === i.state.update.target) {
    i.state.update = { target: null, phase: null, failed: null };
  }
  i.state.sessions = hello.sessions;
  i.state.agents = hello.agents ?? ['claude'];
  // Back in touch with the box: whatever the outage said is over. A failed action's message
  // keeps its own few seconds (a pairing that failed while this daemon was opened again).
  storeErrors.clearConnection(i);
  i.vapidPublicKey = hello.vapidPublicKey ?? null;
  // Push is on offer once the box has a key, unless this page can never subscribe.
  const offerPush = i.vapidPublicKey !== null && i.options.subscribePush !== undefined;
  if (i.state.push === 'unavailable' && offerPush) i.state.push = 'off';
  await Promise.all([...i.logs.values()].map((log) => syncLog(i, log)));
  await enablePush(i, false);
  // With a sound chosen the device needs the box's "Notify me when" settings to know which
  // events to ring for, and another device may have changed them since the last connect; until
  // they arrive every trigger rings (notification-sound.ts), so a refusal is not an outage.
  if (i.state.sound !== 'none') {
    try {
      i.state.settings = await call(i, 'settings.get', {});
    } catch {
      // Whatever the box last sent, or all-on, stands.
    }
  }
};

const patchSummary = (i: StoreInternals, event: FluxEvent): void => {
  const summary = i.state.sessions.find((s) => s.session === event.session);
  if (summary === undefined) {
    void refreshSessions(i);
    return;
  }
  summary.lastSeq = Math.max(summary.lastSeq, event.seq);
  summary.updatedAt = event.ts;
  if (!fluxEvent.isKnown(event)) return;
  if (event.type === 'session.state') summary.state = event.payload.state;
  else if (event.type === 'session.renamed') summary.title = event.payload.title;
  else if (event.type === 'session.head') summary.head = event.payload.head;
};

const onEvent = (i: StoreInternals, event: FluxEvent): void => {
  // Before the connection is adopted (mid-pairing) nothing can be asked back; hello will bring
  // the session list and every open log syncs after it.
  if (i.connection === null) return;
  if (fluxEvent.isKnown(event) && event.type === 'rate_limit') {
    i.state.rateWindows = event.payload.windows;
  }
  const wasRunning = i.state.sessions.find((s) => s.session === event.session)?.state === 'running';
  deviceChoices.sound.onEvent(i, event, wasRunning);
  patchSummary(i, event);
  const log = i.logs.get(event.session);
  if (log === undefined) return;
  // A turn that ends mid-thought (interrupt, crash) never sends the block's stop.
  if (
    fluxEvent.isKnown(event) &&
    event.type === 'session.state' &&
    event.payload.state !== 'running'
  ) {
    const view = i.state.logs[event.session];
    if (view !== undefined) view.thinking = null;
  }
  const receipt = log.receive(event);
  if (receipt === 'applied') logCache.publish(i, log);
  else if (receipt === 'gap') {
    void syncLog(i, log).catch((error: unknown) => {
      reportError(i, error);
    });
  }
};

// Signals about a session that are shown, not logged (protocol.md § 6). Text arriving ends
// the thinking indicator even without the block's stop, since the reply is what it was for.
const onNotice = (view: LogView, data: Ephemeral): void => {
  if (data.type === 'agent.thinking') {
    view.thinking = data.active
      ? { estimatedTokens: data.estimatedTokens ?? view.thinking?.estimatedTokens ?? null }
      : null;
  } else if (data.type === 'agent.context') {
    view.context = { tokens: data.tokens, window: data.window ?? null };
  } else if (data.type === 'vcs.changed') {
    view.changes += 1;
  } else if (data.type === 'delta' && data.text !== '') {
    view.thinking = null;
  }
};

// The runner's client scrollback is bounded (ADR 0026): a run keeps at most this much text, so a
// noisy command cannot flood the DOM; the oldest is dropped once it overruns.
const runnerOutputCap = 256 * 1024;

const onShellOutput = (i: StoreInternals, runId: string, chunk: string): void => {
  const run = i.state.runner.runs.find((r) => r.runId === runId);
  if (run === undefined) return;
  const combined = run.output + chunk;
  run.output =
    combined.length > runnerOutputCap
      ? combined.slice(combined.length - runnerOutputCap)
      : combined;
};

const onShellExit = (
  i: StoreInternals,
  data: { runId: string; code: number | null; signal: string | null; truncated: boolean },
): void => {
  const run = i.state.runner.runs.find((r) => r.runId === data.runId);
  if (run !== undefined)
    run.exit = { code: data.code, signal: data.signal, truncated: data.truncated };
  if (i.state.runner.activeRunId === data.runId) i.state.runner.activeRunId = null;
};

const onEphemeral = (i: StoreInternals, data: Ephemeral): void => {
  if (data.type === 'device.revoked') {
    if (data.deviceId === i.deviceId) void unpair(i, revokedReason(i));
    return;
  }
  // The command-runner notices are session-less (ADR 0026): output accumulates on its run, exit
  // records the code/signal and re-enables the input. Both may be dropped, which is acceptable.
  if (data.type === 'shell.output') {
    onShellOutput(i, data.runId, data.chunk);
    return;
  }
  if (data.type === 'shell.exited') {
    onShellExit(i, data);
    return;
  }
  // The two self-update notices are session-less (protocol.md § 6): progress advances the phase,
  // a failure records its reason for Settings to show; either may be dropped, which is fine.
  if (data.type === 'update.progress') {
    i.state.update.phase = data.phase;
    i.state.update.failed = null;
    return;
  }
  if (data.type === 'update.failed') {
    i.state.update.failed = data.reason;
    return;
  }
  const log = i.logs.get(data.session);
  const view = i.state.logs[data.session];
  if (log === undefined || view === undefined) return;
  log.delta(data);
  view.streaming = log.streaming();
  onNotice(view, data);
};

const onStatus = (i: StoreInternals, status: StoreInternals['state']['status']): void => {
  i.state.status = status;
  // While pairing, the caller runs afterConnect once pair.request has been accepted; a hello
  // before that would be refused as not_paired.
  if (status === 'connected' && i.state.phase === 'paired') {
    const link = i.link;
    void afterConnect(i).catch((error: unknown) => {
      reportFor(i, link, error, 'connection');
    });
  }
};

// The callbacks of one connection, live only while `link` is the adopted one (`i.link`): a
// pairing under way beside the open daemon, or a daemon being switched away from, cannot touch
// the state the open daemon's screens are showing.
const options = (i: StoreInternals, link: object): LinkOptions => {
  const { minBackoffMs, maxBackoffMs } = i.options;
  const live = (): boolean => i.link === link;
  return {
    socket: i.options.socket,
    onEvent: (event) => {
      if (live()) onEvent(i, event);
    },
    onEphemeral: (data) => {
      if (live()) onEphemeral(i, data);
    },
    onStatus: (status) => {
      if (live()) onStatus(i, status);
    },
    onError: (error) => {
      if (live()) reportError(i, error, 'connection');
    },
    ...(minBackoffMs === undefined ? {} : { minBackoffMs }),
    ...(maxBackoffMs === undefined ? {} : { maxBackoffMs }),
  };
};

// Takes the connection boot, a switch or pairing made, and reads the device's own preferences
// once, here rather than on every connect so a choice being saved is not overwritten by a
// reconnect. The read comes first: nothing is handled until adoption is complete (onEvent's
// guard). From here `link`'s callbacks are the live ones, and the status is the connection's.
const adopt = async (i: StoreInternals, connection: Connection, link: object): Promise<void> => {
  await deviceChoices.load(i);
  i.connection = connection;
  i.link = link;
  i.sync = syncSession(connection.call);
  i.state.status = connection.status();
};

export const boxLink: {
  options: typeof options;
  adopt: typeof adopt;
  afterConnect: typeof afterConnect;
  syncLog: typeof syncLog;
  refreshSessions: typeof refreshSessions;
  enablePush: typeof enablePush;
  reportError: typeof reportError;
  reportFor: typeof reportFor;
  clearError: typeof clearError;
  clearActionError: typeof clearActionError;
  attempt: typeof attempt;
  call: typeof call;
  unpair: typeof unpair;
} = {
  options,
  adopt,
  afterConnect,
  syncLog,
  refreshSessions,
  enablePush,
  reportError,
  reportFor,
  clearError,
  clearActionError,
  attempt,
  call,
  unpair,
};
