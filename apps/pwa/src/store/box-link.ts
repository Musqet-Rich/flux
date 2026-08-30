import type { Ephemeral, FluxEvent, RpcMethods } from '@flux/protocol';
import { fluxEvent, guards, protocolVersion } from '@flux/protocol';

import { ClientError } from '../client/client-error.ts';
import type { Connection, ConnectionOptions } from '../client/create-connection.ts';
import type { SessionLog } from '../client/create-session-log.ts';
import { pairedBox } from '../client/paired-box.ts';
import { syncSession } from '../client/sync-session.ts';
import { logCache } from './log-cache.ts';
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

// Forgets the box: the stored keys go, the connection stops, and the app lands on the pair
// screen with `reason` as the error. Used when the box says this device is no longer paired.
const unpair = async (i: StoreInternals, reason: string): Promise<void> => {
  i.connection?.stop();
  i.connection = null;
  i.sync = null;
  i.deviceId = null;
  i.logs.clear();
  i.state.logs = {};
  i.state.sessions = [];
  i.state.devices = [];
  i.state.settings = null;
  i.state.skills = null;
  i.state.daemon = null;
  i.state.daemonVersion = null;
  i.state.update = { target: null, phase: null, failed: null };
  i.state.updateCheck = null;
  i.state.phase = 'unpaired';
  reportError(i, reason, 'connection');
  // The keys, then the old box's cached logs: another box's session ids must not collide.
  await i.options.storage.remove(pairedBox.storageKey).catch(() => {
    // Nothing to do: the keys are already out of memory and the next boot re-reads storage.
  });
  await i.options.storage.clear('log:').catch(() => {
    // A stale cache costs a sync after the next pairing, nothing more.
  });
};

const revokedReason = 'This device is no longer paired with the box. Pair it again to continue.';

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
    await unpair(i, revokedReason);
    throw new ClientError('not_paired', revokedReason);
  }
};

// Runs an action for a view: a failure lands in `state.error` for the status bar and the view
// gets false, never a rejection to handle. A success takes a previous action's failure with it.
const attempt = async (i: StoreInternals, action: () => Promise<unknown>): Promise<boolean> => {
  try {
    await action();
    storeErrors.clearAction(i);
    return true;
  } catch (error) {
    reportError(i, error);
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
  const run = async (): Promise<void> => {
    try {
      i.state.sessions = await call(i, 'sessions.list', {});
    } catch (error) {
      reportError(i, error);
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
const enablePush = async (i: StoreInternals, prompt: boolean): Promise<boolean> => {
  const { subscribePush } = i.options;
  const key = i.vapidPublicKey;
  if (i.state.push === 'on' || key === null || subscribePush === undefined) return false;
  const subscription = await subscribePush(key, prompt);
  if (!guards.isRecord(subscription)) return false;
  await call(i, 'push.subscribe', { subscription });
  i.state.push = 'on';
  return true;
};

const afterConnect = async (i: StoreInternals): Promise<void> => {
  const hello = await call(i, 'hello', { protocol: protocolVersion });
  i.state.daemon = hello.daemon;
  i.state.daemonVersion = hello.version ?? null;
  // A self-update succeeded when the box comes back on the version we asked it to install: the
  // channel dropped on its exit, reconnect brought the new `hello.version`, so clear the banner.
  if (i.state.update.target !== null && hello.version === i.state.update.target) {
    i.state.update = { target: null, phase: null, failed: null };
  }
  i.state.sessions = hello.sessions;
  i.state.agents = hello.agents ?? ['claude'];
  // Back in touch with the box: whatever the outage said is over.
  storeErrors.clear(i);
  i.vapidPublicKey = hello.vapidPublicKey ?? null;
  // Push is on offer once the box has a key, unless this page can never subscribe.
  const offerPush = i.vapidPublicKey !== null && i.options.subscribePush !== undefined;
  if (i.state.push === 'unavailable' && offerPush) i.state.push = 'off';
  await Promise.all([...i.logs.values()].map((log) => syncLog(i, log)));
  await enablePush(i, false);
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
};

const onEvent = (i: StoreInternals, event: FluxEvent): void => {
  // Before the connection is adopted (mid-pairing) nothing can be asked back; hello will bring
  // the session list and every open log syncs after it.
  if (i.connection === null) return;
  if (fluxEvent.isKnown(event) && event.type === 'rate_limit') {
    i.state.rateWindows = event.payload.windows;
  }
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

const onEphemeral = (i: StoreInternals, data: Ephemeral): void => {
  if (data.type === 'device.revoked') {
    if (data.deviceId === i.deviceId) void unpair(i, revokedReason);
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
    void afterConnect(i).catch((error: unknown) => {
      reportError(i, error, 'connection');
    });
  }
};

const options = (i: StoreInternals): LinkOptions => {
  const { minBackoffMs, maxBackoffMs } = i.options;
  return {
    socket: i.options.socket,
    onEvent: (event) => {
      onEvent(i, event);
    },
    onEphemeral: (data) => {
      onEphemeral(i, data);
    },
    onStatus: (status) => {
      onStatus(i, status);
    },
    onError: (error) => {
      reportError(i, error, 'connection');
    },
    ...(minBackoffMs === undefined ? {} : { minBackoffMs }),
    ...(maxBackoffMs === undefined ? {} : { maxBackoffMs }),
  };
};

const adopt = (i: StoreInternals, connection: Connection): void => {
  i.connection = connection;
  i.sync = syncSession(connection.call);
};

export const boxLink: {
  options: typeof options;
  adopt: typeof adopt;
  afterConnect: typeof afterConnect;
  syncLog: typeof syncLog;
  refreshSessions: typeof refreshSessions;
  enablePush: typeof enablePush;
  reportError: typeof reportError;
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
  clearError,
  clearActionError,
  attempt,
  call,
  unpair,
};
