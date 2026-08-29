import type { CodeRef, RpcMethods, SessionSummary } from '@flux/protocol';

import { createConnection } from '../client/create-connection.ts';
import type { RpcCall } from '../client/create-rpc-client.ts';
import { createSessionLog } from '../client/create-session-log.ts';
import { pairDevice } from '../client/pair-device.ts';
import { pairedBox } from '../client/paired-box.ts';
import { boxLink } from './box-link.ts';
import { logCache } from './log-cache.ts';
import { pendingComments } from './pending-comments.ts';
import type { StoreInternals, StoreOptions, StoreState } from './store-state.ts';
import { storeState } from './store-state.ts';

// The app's one store (architecture.md § PWA): storage plus connection behind a reactive state
// object and a handful of actions. Built with injected storage and sockets so it runs in Node
// against the fake relay; the browser wires IndexedDB and WebSocket in app-store.ts.

export interface Store {
  state: StoreState;
  // Loads the paired box from storage and connects, or lands on the pair screen.
  boot: () => Promise<void>;
  // Pairs from a link's fragment; on failure `state.error` says why and the phase is unpaired.
  pair: (relayUrl: string, fragment: string) => Promise<void>;
  // Makes a session's log available in `state.logs`: cache first, then a sync.
  open: (session: string) => Promise<void>;
  // Sends a message carrying every pending comment.
  send: (session: string, text: string) => Promise<void>;
  answer: (session: string, askId: string, answer: string) => Promise<void>;
  addComment: (session: string, ref: CodeRef, text: string) => Promise<void>;
  removeComment: (session: string, commentId: string) => Promise<void>;
  createSession: (params: RpcMethods['sessions.create']['params']) => Promise<SessionSummary>;
  refreshSessions: () => Promise<void>;
  call: RpcCall;
  stop: () => void;
}

const boot = async (i: StoreInternals): Promise<void> => {
  const stored = await i.options.storage.get(pairedBox.storageKey).catch(() => null);
  const box = await pairedBox.load(stored);
  if (box === null) {
    i.state.phase = 'unpaired';
    return;
  }
  const connection = await createConnection({
    ...boxLink.options(i),
    relayUrl: box.record.relayUrl,
    keys: box.keys,
    boxPub: box.boxPub,
  });
  boxLink.adopt(i, connection);
  i.state.phase = 'paired';
  connection.start();
};

const pair = async (i: StoreInternals, relayUrl: string, fragment: string): Promise<void> => {
  i.state.phase = 'pairing';
  i.state.error = null;
  try {
    const { box, connection } = await pairDevice({ ...boxLink.options(i), relayUrl, fragment });
    await i.options.storage.set(pairedBox.storageKey, box.record);
    boxLink.adopt(i, connection);
    i.state.phase = 'paired';
    await boxLink.afterConnect(i);
  } catch (error) {
    boxLink.reportError(i, error);
    i.state.phase = 'unpaired';
  }
};

const open = async (i: StoreInternals, session: string): Promise<void> => {
  const existing = i.logs.get(session);
  if (existing !== undefined) return boxLink.syncLog(i, existing);
  const log = createSessionLog(session, await logCache.load(i, session));
  // Two views can open the same session before the cache read settles; the first one wins.
  const raced = i.logs.get(session);
  if (raced !== undefined) return boxLink.syncLog(i, raced);
  i.logs.set(session, log);
  logCache.publish(i, log);
  return boxLink.syncLog(i, log);
};

const send = async (i: StoreInternals, session: string, text: string): Promise<void> => {
  const events = i.logs.get(session)?.events() ?? [];
  const commentIds = pendingComments(events).map((c) => c.commentId);
  const params = commentIds.length > 0 ? { session, text, commentIds } : { session, text };
  await boxLink.call(i, 'agent.send', params);
};

const createSession = async (
  i: StoreInternals,
  params: RpcMethods['sessions.create']['params'],
): Promise<SessionSummary> => {
  const summary = await boxLink.call(i, 'sessions.create', params);
  if (!i.state.sessions.some((s) => s.session === summary.session)) {
    i.state.sessions.push(summary);
  }
  return summary;
};

export const createStore = (options: StoreOptions): Store => {
  const i: StoreInternals = {
    options,
    state: storeState(),
    logs: new Map(),
    connection: null,
    sync: null,
    pushDone: false,
    refreshing: null,
  };
  return {
    state: i.state,
    boot: () => boot(i),
    pair: (relayUrl, fragment) => pair(i, relayUrl, fragment),
    open: (session) => open(i, session),
    send: (session, text) => send(i, session, text),
    answer: async (session, askId, answer) => {
      await boxLink.call(i, 'agent.answer', { session, askId, answer });
    },
    addComment: async (session, ref, text) => {
      await boxLink.call(i, 'comments.add', { session, ref, text });
    },
    removeComment: async (session, commentId) => {
      await boxLink.call(i, 'comments.remove', { session, commentId });
    },
    createSession: (params) => createSession(i, params),
    refreshSessions: () => boxLink.refreshSessions(i),
    call: (method, params) => boxLink.call(i, method, params),
    stop: () => {
      i.connection?.stop();
    },
  };
};
