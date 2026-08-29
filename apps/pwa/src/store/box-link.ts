import type { Ephemeral, FluxEvent, RpcMethods } from '@flux/protocol';
import { guards, protocolVersion } from '@flux/protocol';

import { ClientError } from '../client/client-error.ts';
import type { Connection, ConnectionOptions } from '../client/create-connection.ts';
import type { SessionLog } from '../client/create-session-log.ts';
import { syncSession } from '../client/sync-session.ts';
import { logCache } from './log-cache.ts';
import type { StoreInternals } from './store-state.ts';

// The store's side of the connection (architecture.md § Sync model): what to do when the channel
// comes up, when an event or delta arrives, and when a call fails. Everything here mutates
// `i.state` and nothing else touches the connection.

type LinkOptions = Omit<ConnectionOptions, 'relayUrl' | 'keys' | 'boxPub'>;

const reportError = (i: StoreInternals, error: unknown): void => {
  i.state.error = error instanceof Error ? error.message : String(error);
};

const call = <M extends keyof RpcMethods>(
  i: StoreInternals,
  method: M,
  params: RpcMethods[M]['params'],
): Promise<RpcMethods[M]['result']> =>
  i.connection === null
    ? Promise.reject(new ClientError('offline', 'not paired'))
    : i.connection.call(method, params);

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

const subscribePush = async (i: StoreInternals, key: string | undefined): Promise<void> => {
  const { subscribePush: subscribe } = i.options;
  if (i.pushDone || key === undefined || subscribe === undefined) return;
  i.pushDone = true;
  const subscription = await subscribe(key);
  if (!guards.isRecord(subscription)) return;
  await call(i, 'push.subscribe', { subscription });
};

const afterConnect = async (i: StoreInternals): Promise<void> => {
  const hello = await call(i, 'hello', { protocol: protocolVersion });
  i.state.daemon = hello.daemon;
  i.state.sessions = hello.sessions;
  i.state.error = null;
  await Promise.all([...i.logs.values()].map((log) => syncLog(i, log)));
  await subscribePush(i, hello.vapidPublicKey);
};

const patchSummary = (i: StoreInternals, event: FluxEvent): void => {
  const summary = i.state.sessions.find((s) => s.session === event.session);
  if (summary === undefined) {
    void refreshSessions(i);
    return;
  }
  summary.lastSeq = Math.max(summary.lastSeq, event.seq);
  summary.updatedAt = event.ts;
  if (event.type === 'session.state') summary.state = event.payload.state;
  else if (event.type === 'session.renamed') summary.title = event.payload.title;
};

const onEvent = (i: StoreInternals, event: FluxEvent): void => {
  if (event.type === 'rate_limit') i.state.rateWindows = event.payload.windows;
  patchSummary(i, event);
  const log = i.logs.get(event.session);
  if (log === undefined) return;
  const receipt = log.receive(event);
  if (receipt === 'applied') logCache.publish(i, log);
  else if (receipt === 'gap') {
    void syncLog(i, log).catch((error: unknown) => {
      reportError(i, error);
    });
  }
};

const onEphemeral = (i: StoreInternals, data: Ephemeral): void => {
  const log = i.logs.get(data.session);
  const view = i.state.logs[data.session];
  if (log === undefined || view === undefined) return;
  log.delta(data);
  view.streaming = log.streaming();
};

const onStatus = (i: StoreInternals, status: StoreInternals['state']['status']): void => {
  i.state.status = status;
  // While pairing, the caller runs afterConnect once pair.request has been accepted; a hello
  // before that would be refused as not_paired.
  if (status === 'connected' && i.state.phase === 'paired') {
    void afterConnect(i).catch((error: unknown) => {
      reportError(i, error);
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
  reportError: typeof reportError;
  call: typeof call;
} = { options, adopt, afterConnect, syncLog, refreshSessions, reportError, call };
