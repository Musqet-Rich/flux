import type { CodeRef, RpcMethods, SessionSummary } from '@flux/protocol';

import { ClientError } from '../client/client-error.ts';
import type { Connection } from '../client/create-connection.ts';
import { boxLink } from './box-link.ts';
import { daemonSwitch } from './daemon-switch.ts';
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
  // The device's scheme and text size (ADR 0030): Settings sets them, the editors read the
  // scheme when they are built.
  appearance: StoreOptions['appearance'];
  // Loads the pairings from storage and connects to `daemon` if it is paired (a notification's,
  // ADR 0037), else to the daemon used last, or lands on the pair screen.
  boot: (daemon?: string) => Promise<void>;
  // Pairs from a link's fragment and opens the new daemon, resolving to whether it paired; on
  // failure `state.error` says why. A first pairing that fails lands on the pair screen; one
  // made beside an open daemon (the "Pair another daemon" dialog, which may cancel it through
  // `signal`) leaves that daemon open.
  pair: (relayUrl: string, fragment: string, signal?: AbortSignal) => Promise<boolean>;
  // Lets the open daemon go and opens another paired one (ADR 0037), resolving to whether it is
  // now the open one.
  switchDaemon: (daemon: string) => Promise<boolean>;
  // The operator's Unpair: asks the open daemon to forget this device, forgets the daemon here
  // whatever it answers, and opens the next paired one or lands on the pair screen. Resolves to
  // whether the daemon forgot the device too.
  unpairDevice: () => Promise<boolean>;
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
  // Opens a daemon-managed Help session seeded with `question` (ADR 0008); the question is
  // trimmed before it goes on the wire. The new session is added to the list, like createSession.
  createHelpSession: (question: string) => Promise<SessionSummary>;
  refreshSessions: () => Promise<void>;
  // Git actions resolve to their result, or null with the failure in `state.error`.
  commit: (session: string, message: string, paths?: string[]) => Promise<string | null>;
  push: (session: string) => Promise<{ remote: string; branch: string } | null>;
  openPr: (session: string, pr: PrParams) => Promise<string | null>;
  // The operator command runner (ADR 0026): starts a one-off command and returns its runId, or
  // null with the failure in `state.error` (e.g. a `conflict` while one already runs). Its output
  // streams into `state.runner` over the shell ephemerals; `shellInterrupt` stops a run.
  shellRun: (command: string, cwd?: string) => Promise<string | null>;
  shellInterrupt: (runId: string) => Promise<boolean>;
  call: Connection['call'];
  // The status bar's close button on the shown error.
  dismissError: () => void;
  stop: () => void;
}

const saveFile = async (
  i: StoreInternals,
  session: string,
  path: string,
  content: string,
  ifMatch: string | null,
): Promise<SaveOutcome> => {
  const params =
    ifMatch === null ? { session, path, content } : { session, path, content, ifMatch };
  const link = i.link;
  try {
    const { hash } = await boxLink.call(i, 'fs.write', params);
    boxLink.clearActionError(i);
    return { ok: true, hash };
  } catch (error) {
    if (error instanceof ClientError && error.code === 'conflict') {
      return { ok: false, conflict: true };
    }
    boxLink.reportFor(i, link, error);
    return { ok: false, conflict: false };
  }
};

const addSession = (i: StoreInternals, summary: SessionSummary): SessionSummary => {
  if (!i.state.sessions.some((s) => s.session === summary.session)) {
    i.state.sessions.push(summary);
  }
  return summary;
};

const createSession = async (
  i: StoreInternals,
  params: RpcMethods['sessions.create']['params'],
): Promise<SessionSummary> => addSession(i, await boxLink.call(i, 'sessions.create', params));

const createHelpSession = async (i: StoreInternals, question: string): Promise<SessionSummary> =>
  addSession(i, await boxLink.call(i, 'sessions.createHelp', { question: question.trim() }));

// Like boxLink.attempt, for actions whose result the view needs (a sha, a URL).
const outcome = async <T>(i: StoreInternals, action: () => Promise<T>): Promise<T | null> => {
  const link = i.link;
  try {
    const result = await action();
    boxLink.clearActionError(i);
    return result;
  } catch (error) {
    boxLink.reportFor(i, link, error);
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

// A new run block is created only once the box has accepted the command and named the run, so
// its streamed output (keyed by runId) always has a block to land on; `activeRunId` disables the
// input until the run exits (one at a time).
const shellRun = (i: StoreInternals, command: string, cwd?: string): Promise<string | null> =>
  outcome(i, async () => {
    const params = cwd === undefined ? { command } : { command, cwd };
    const { runId } = await boxLink.call(i, 'shell.run', params);
    i.state.runner.runs.push({ runId, command, output: '', exit: null });
    i.state.runner.activeRunId = runId;
    return runId;
  });

// The status bar's "Enable notifications": a refusal is an action error with the reason the
// browser gave; one that says push can never work here takes the offer away for good.
const enablePush = async (i: StoreInternals): Promise<boolean> => {
  const link = i.link;
  try {
    return await boxLink.enablePush(i, true);
  } catch (error) {
    if (error instanceof ClientError && error.code === 'push_unsupported') {
      i.state.push = 'unavailable';
    }
    boxLink.reportFor(i, link, error);
    return false;
  }
};

const controls = (i: StoreInternals): Pick<Store, 'dismissError' | 'stop'> => ({
  dismissError: () => {
    boxLink.clearError(i);
  },
  stop: () => {
    boxLink.clearError(i);
    // The quiet spell after a notification sound (notification-sound.ts) has nothing to guard
    // once the store is stopped.
    i.soundHush?.();
    i.soundHush = null;
    sessionLogs.stop(i);
    i.connection?.stop();
  },
});

const internals = (options: StoreOptions): StoreInternals => {
  const i: StoreInternals = {
    options,
    state: storeState(),
    logs: new Map(),
    connection: null,
    pairing: null,
    link: null,
    stash: new Map(),
    serial: Promise.resolve(),
    forget: (reason) => daemonSwitch.forget(i, reason),
    sync: null,
    vapidPublicKey: null,
    refreshing: null,
    deviceId: null,
    errorTimer: null,
    connectionError: null,
    soundHush: null,
    cacheWrites: new Map(),
    files: new Map(),
    thumbLoads: new Map(),
    thumbOwners: new Map(),
  };
  return i;
};

// The daemons this device is paired with (daemon-switch.ts, ADR 0037).
const daemonActions = (
  i: StoreInternals,
): Pick<Store, 'boot' | 'pair' | 'switchDaemon' | 'unpairDevice'> => ({
  boot: (daemon) => daemonSwitch.boot(i, daemon),
  pair: (relayUrl, fragment, signal) => daemonSwitch.pair(i, relayUrl, fragment, signal),
  switchDaemon: (daemon) => daemonSwitch.switchTo(i, daemon),
  unpairDevice: () => daemonSwitch.unpair(i),
});

export const createStore = (options: StoreOptions): Store => {
  const i = internals(options);
  return {
    ...settingsActions(i),
    ...sessionActions(i),
    state: i.state,
    appearance: options.appearance,
    ...daemonActions(i),
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
    createHelpSession: (question) => createHelpSession(i, question),
    refreshSessions: () => boxLink.refreshSessions(i),
    ...gitActions(i),
    shellRun: (command, cwd) => shellRun(i, command, cwd),
    shellInterrupt: (runId) =>
      boxLink.attempt(i, () => boxLink.call(i, 'shell.interrupt', { runId })),
    call: (method, params) => boxLink.call(i, method, params),
    ...controls(i),
  };
};
