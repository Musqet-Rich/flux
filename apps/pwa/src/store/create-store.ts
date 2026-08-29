import type { CodeRef, RpcMethods, SessionSummary } from '@flux/protocol';

import { createConnection } from '../client/create-connection.ts';
import type { RpcCall } from '../client/create-rpc-client.ts';
import { pairDevice } from '../client/pair-device.ts';
import { pairedBox } from '../client/paired-box.ts';
import { boxLink } from './box-link.ts';
import { pendingComments } from './pending-comments.ts';
import { sessionLogs } from './session-logs.ts';
import type { StoreInternals, StoreOptions, StoreState } from './store-state.ts';
import { storeState } from './store-state.ts';

// The app's one store (architecture.md § PWA): storage plus connection behind a reactive state
// object and a handful of actions. Built with injected storage and sockets so it runs in Node
// against the fake relay; the browser wires IndexedDB and WebSocket in app-store.ts.
//
// Actions a view fires resolve to whether they succeeded; the failure itself is in
// `state.error` for the status bar, so views never handle rejections.

export interface Store {
  state: StoreState;
  // Loads the paired box from storage and connects, or lands on the pair screen.
  boot: () => Promise<void>;
  // Pairs from a link's fragment; on failure `state.error` says why and the phase is unpaired.
  pair: (relayUrl: string, fragment: string) => Promise<void>;
  // Makes a session's log available in `state.logs`: cache first, then a sync.
  open: (session: string) => Promise<void>;
  // Sends a message carrying every pending comment.
  send: (session: string, text: string) => Promise<boolean>;
  answer: (session: string, askId: string, answer: string) => Promise<boolean>;
  interrupt: (session: string) => Promise<boolean>;
  addComment: (session: string, ref: CodeRef, text: string) => Promise<boolean>;
  removeComment: (session: string, commentId: string) => Promise<boolean>;
  // Asks the browser for a push subscription under a user gesture and stores it on the box.
  enablePush: () => Promise<boolean>;
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

const send = (i: StoreInternals, session: string, text: string): Promise<boolean> => {
  const events = i.logs.get(session)?.events() ?? [];
  const commentIds = pendingComments(events).map((c) => c.commentId);
  const params = commentIds.length > 0 ? { session, text, commentIds } : { session, text };
  return boxLink.attempt(i, () => boxLink.call(i, 'agent.send', params));
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
    vapidPublicKey: null,
    refreshing: null,
  };
  return {
    state: i.state,
    boot: () => boot(i),
    pair: (relayUrl, fragment) => pair(i, relayUrl, fragment),
    // Views fire this from onMounted and cannot handle a rejection; a failed sync is reported.
    open: async (session) => {
      await boxLink.attempt(i, () => sessionLogs.open(i, session));
    },
    send: (session, text) => send(i, session, text),
    answer: (session, askId, answer) =>
      boxLink.attempt(i, () => boxLink.call(i, 'agent.answer', { session, askId, answer })),
    interrupt: (session) =>
      boxLink.attempt(i, () => boxLink.call(i, 'agent.interrupt', { session })),
    addComment: (session, ref, text) =>
      boxLink.attempt(i, () => boxLink.call(i, 'comments.add', { session, ref, text })),
    removeComment: (session, commentId) =>
      boxLink.attempt(i, () => boxLink.call(i, 'comments.remove', { session, commentId })),
    enablePush: async () => {
      try {
        return await boxLink.enablePush(i, true);
      } catch (error) {
        boxLink.reportError(i, error);
        return false;
      }
    },
    createSession: (params) => createSession(i, params),
    refreshSessions: () => boxLink.refreshSessions(i),
    call: (method, params) => boxLink.call(i, method, params),
    stop: () => {
      i.connection?.stop();
    },
  };
};
