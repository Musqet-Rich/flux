import type { CodeRef, RpcMethods, SessionSummary } from '@flux/protocol';

import { ClientError } from '../client/client-error.ts';
import type { Connection } from '../client/create-connection.ts';
import { createConnection } from '../client/create-connection.ts';
import { pairDevice } from '../client/pair-device.ts';
import { pairedBox } from '../client/paired-box.ts';
import { boxLink } from './box-link.ts';
import { pendingComments } from './pending-comments.ts';
import { sessionLogs } from './session-logs.ts';
import type { SettingsActions } from './settings-actions.ts';
import { settingsActions } from './settings-actions.ts';
import type { StoreInternals, StoreOptions, StoreState } from './store-state.ts';
import { storeState } from './store-state.ts';

// The app's one store (architecture.md § PWA): storage plus connection behind a reactive state
// object and a handful of actions. Built with injected storage and sockets so it runs in Node
// against the fake relay; the browser wires IndexedDB and WebSocket in app-store.ts.
//
// Actions a view fires resolve to whether they succeeded; the failure itself is in
// `state.error` for the status bar, so views never handle rejections.

export type PrParams = Omit<RpcMethods['git.pr']['params'], 'session'>;

// What saving a file came to. A conflict is the view's to handle (it offers a reload), so it is
// not put in `state.error` like other failures.
export type SaveOutcome = { ok: true; hash: string } | { ok: false; conflict: boolean };

export interface Store extends SettingsActions {
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
  // Writes a file to the worktree; `ifMatch` is the hash the file was read with, or null to
  // overwrite whatever is there now.
  saveFile: (
    session: string,
    path: string,
    content: string,
    ifMatch: string | null,
  ) => Promise<SaveOutcome>;
  // Asks the browser for a push subscription under a user gesture and stores it on the box.
  enablePush: () => Promise<boolean>;
  createSession: (params: RpcMethods['sessions.create']['params']) => Promise<SessionSummary>;
  refreshSessions: () => Promise<void>;
  // Git actions resolve to their result, or null with the failure in `state.error`.
  commit: (session: string, message: string, paths?: string[]) => Promise<string | null>;
  push: (session: string) => Promise<{ remote: string; branch: string } | null>;
  openPr: (session: string, pr: PrParams) => Promise<string | null>;
  call: Connection['call'];
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
  i.deviceId = box.record.deviceId;
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
    i.deviceId = box.record.deviceId;
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

const saveFile = async (
  i: StoreInternals,
  session: string,
  path: string,
  content: string,
  ifMatch: string | null,
): Promise<SaveOutcome> => {
  const params =
    ifMatch === null ? { session, path, content } : { session, path, content, ifMatch };
  try {
    const { hash } = await boxLink.call(i, 'fs.write', params);
    return { ok: true, hash };
  } catch (error) {
    if (error instanceof ClientError && error.code === 'conflict') {
      return { ok: false, conflict: true };
    }
    boxLink.reportError(i, error);
    return { ok: false, conflict: false };
  }
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

// Like boxLink.attempt, for actions whose result the view needs (a sha, a URL).
const outcome = async <T>(i: StoreInternals, action: () => Promise<T>): Promise<T | null> => {
  try {
    return await action();
  } catch (error) {
    boxLink.reportError(i, error);
    return null;
  }
};

const gitActions = (i: StoreInternals): Pick<Store, 'commit' | 'push' | 'openPr'> => ({
  commit: (session, message, paths) =>
    outcome(i, async () => {
      const params = paths === undefined ? { session, message } : { session, message, paths };
      return (await boxLink.call(i, 'git.commit', params)).sha;
    }),
  push: (session) => outcome(i, () => boxLink.call(i, 'git.push', { session })),
  openPr: (session, pr) =>
    outcome(i, async () => (await boxLink.call(i, 'git.pr', { session, ...pr })).url),
});

export const createStore = (options: StoreOptions): Store => {
  const i: StoreInternals = {
    options,
    state: storeState(),
    logs: new Map(),
    connection: null,
    sync: null,
    vapidPublicKey: null,
    refreshing: null,
    deviceId: null,
  };
  return {
    ...settingsActions(i),
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
    saveFile: (session, path, content, ifMatch) => saveFile(i, session, path, content, ifMatch),
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
    ...gitActions(i),
    call: (method, params) => boxLink.call(i, method, params),
    stop: () => {
      i.connection?.stop();
    },
  };
};
