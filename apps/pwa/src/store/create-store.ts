import type { CodeRef, RpcMethods, SessionSummary } from '@flux/protocol';

import { ClientError } from '../client/client-error.ts';
import type { Connection } from '../client/create-connection.ts';
import { createConnection } from '../client/create-connection.ts';
import { pairDevice } from '../client/pair-device.ts';
import { pairedBox } from '../client/paired-box.ts';
import { boxLink } from './box-link.ts';
import type { SessionActions } from './session-actions.ts';
import { sessionActions } from './session-actions.ts';
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
// `state.error` for the status bar, so views never handle rejections. Errors are transient
// (store-errors.ts): an action's clears itself, a connection's clears when the box is back.

export type PrParams = Omit<RpcMethods['git.pr']['params'], 'session'>;

// What saving a file came to. A conflict is the view's to handle (it offers a reload), so it is
// not put in `state.error` like other failures.
export type SaveOutcome = { ok: true; hash: string } | { ok: false; conflict: boolean };

export interface Store extends SettingsActions, SessionActions {
  state: StoreState;
  // Loads the paired box from storage and connects, or lands on the pair screen.
  boot: () => Promise<void>;
  // Pairs from a link's fragment; on failure `state.error` says why and the phase is unpaired.
  pair: (relayUrl: string, fragment: string) => Promise<void>;
  // Makes a session's log available in `state.logs`: cache first, then a sync.
  open: (session: string) => Promise<void>;
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
  // The status bar's × on the shown error.
  dismissError: () => void;
  stop: () => void;
}

const boot = async (i: StoreInternals): Promise<void> => {
  const stored = await i.options.storage.get(pairedBox.storageKey).catch(() => null);
  const box = await pairedBox.load(stored);
  if (box === null) {
    i.state.phase = 'unpaired';
    return;
  }
  const options = { ...boxLink.options(i), relayUrl: box.record.relayUrl };
  try {
    const connection = await createConnection({ ...options, keys: box.keys, boxPub: box.boxPub });
    boxLink.adopt(i, connection);
    i.deviceId = box.record.deviceId;
    i.state.phase = 'paired';
    connection.start();
  } catch (error) {
    // A stored relay the connection refuses (plaintext off loopback) needs a new pairing link;
    // the pair screen with the reason is where that starts.
    boxLink.reportError(i, error, 'connection');
    i.state.phase = 'unpaired';
  }
};

const pair = async (i: StoreInternals, relayUrl: string, fragment: string): Promise<void> => {
  i.state.phase = 'pairing';
  boxLink.clearError(i);
  try {
    const { box, connection } = await pairDevice({ ...boxLink.options(i), relayUrl, fragment });
    await i.options.storage.set(pairedBox.storageKey, box.record);
    boxLink.adopt(i, connection);
    i.deviceId = box.record.deviceId;
    i.state.phase = 'paired';
    await boxLink.afterConnect(i);
  } catch (error) {
    boxLink.reportError(i, error, 'connection');
    i.state.phase = 'unpaired';
  }
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
    boxLink.clearActionError(i);
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
    const result = await action();
    boxLink.clearActionError(i);
    return result;
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

// The status bar's "Enable notifications": a refusal is an action error with the reason the
// browser gave; one that says push can never work here takes the offer away for good.
const enablePush = async (i: StoreInternals): Promise<boolean> => {
  try {
    return await boxLink.enablePush(i, true);
  } catch (error) {
    if (error instanceof ClientError && error.code === 'push_unsupported') {
      i.state.push = 'unavailable';
    }
    boxLink.reportError(i, error);
    return false;
  }
};

const controls = (i: StoreInternals): Pick<Store, 'dismissError' | 'stop'> => ({
  dismissError: () => {
    boxLink.clearError(i);
  },
  stop: () => {
    boxLink.clearError(i);
    i.connection?.stop();
  },
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
    errorTimer: null,
    connectionError: null,
    files: new Map(),
    thumbLoads: new Map(),
    thumbOwners: new Map(),
  };
  return {
    ...settingsActions(i),
    ...sessionActions(i),
    state: i.state,
    boot: () => boot(i),
    pair: (relayUrl, fragment) => pair(i, relayUrl, fragment),
    // Views fire this from onMounted and cannot handle a rejection; a failed sync is reported.
    open: async (session) => {
      await boxLink.attempt(i, () => sessionLogs.open(i, session));
    },
    answer: (session, askId, answer) =>
      boxLink.attempt(i, () => boxLink.call(i, 'agent.answer', { session, askId, answer })),
    interrupt: (session) =>
      boxLink.attempt(i, () => boxLink.call(i, 'agent.interrupt', { session })),
    addComment: (session, ref, text) =>
      boxLink.attempt(i, () => boxLink.call(i, 'comments.add', { session, ref, text })),
    removeComment: (session, commentId) =>
      boxLink.attempt(i, () => boxLink.call(i, 'comments.remove', { session, commentId })),
    saveFile: (session, path, content, ifMatch) => saveFile(i, session, path, content, ifMatch),
    enablePush: () => enablePush(i),
    createSession: (params) => createSession(i, params),
    refreshSessions: () => boxLink.refreshSessions(i),
    ...gitActions(i),
    call: (method, params) => boxLink.call(i, method, params),
    ...controls(i),
  };
};
