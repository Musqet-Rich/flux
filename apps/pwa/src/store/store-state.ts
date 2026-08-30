import type {
  AgentKind,
  Device,
  FluxEvent,
  RateWindow,
  SessionSummary,
  Settings,
} from '@flux/protocol';
import { reactive } from 'vue';

import type { Connection, ConnectionStatus } from '../client/create-connection.ts';
import type { Storage } from '../client/create-memory-storage.ts';
import type { SessionLog } from '../client/create-session-log.ts';
import type { SocketFactory } from '../client/socket.ts';
import type { SyncSession } from '../client/sync-session.ts';

// What the views see (architecture.md § PWA): one connection store and one view per opened
// session, all in a single reactive object so components can read it directly.

export type StorePhase = 'booting' | 'unpaired' | 'pairing' | 'paired';

// `unavailable` until the box offers a VAPID key, `off` until this device's subscription is
// stored on the box, `on` after that.
export type PushState = 'unavailable' | 'off' | 'on';

// The agent is inside a thinking block; the count is Claude's running estimate once reported.
export interface Thinking {
  estimatedTokens: number | null;
}

// The context window in use, from `agent.context` (the prompt size of the last model call).
// `window` is null when the box could not name the model's window (context-window.ts).
export interface SessionContext {
  tokens: number;
  window: number | null;
}

export interface LogView {
  events: FluxEvent[];
  streaming: string;
  lastSeq: number;
  thinking: Thinking | null;
  // The context window in use, shown in the status bar for the open session; null until the
  // agent reports its first model call.
  context: SessionContext | null;
  // Bumps on every `vcs.changed` notice, so the changes screen knows to refetch.
  changes: number;
}

// Unsaved editor text, kept across navigation so leaving the editor loses nothing. Keyed by
// `session\0path`; `hash` is the file version the draft was typed over.
export interface Draft {
  hash: string;
  text: string;
}

// A file on the composer (ADR 0020): uploading from the moment it is added, `ready` once the
// box has it whole, `failed` with the reason otherwise. `key` is the chip's own id; `id` the
// box's, once `attach.begin` has answered. `preview` is an object URL of the local image.
export interface PendingAttachment {
  key: string;
  id: string | null;
  name: string;
  mime: string;
  size: number;
  image: boolean;
  preview: string | null;
  status: 'uploading' | 'ready' | 'failed';
  progress: number;
  error: string | null;
}

// The composer's unsent state per session: the text and the attachments, kept across
// navigation like an editor draft.
export interface ComposerDraft {
  text: string;
  attachments: PendingAttachment[];
}

// Where an error came from decides how long it stays (store-errors.ts): an `action` error goes
// on its own, a `connection` error waits for the condition to clear or a dismissal.
export type ErrorKind = 'action' | 'connection';

export interface StoreError {
  message: string;
  kind: ErrorKind;
}

export interface StoreState {
  phase: StorePhase;
  status: ConnectionStatus;
  daemon: string | null;
  // The daemon's app version from `hello` (ADR 0021); null until connected, or when talking to a
  // daemon built before it sent one. Shown read-only in Settings; no update action yet.
  daemonVersion: string | null;
  error: StoreError | null;
  push: PushState;
  sessions: SessionSummary[];
  // Agents the box can run, from `hello`; a daemon that predates the field has claude only.
  agents: AgentKind[];
  rateWindows: RateWindow[];
  logs: Record<string, LogView>;
  drafts: Record<string, Draft>;
  composers: Record<string, ComposerDraft>;
  // Blob URLs of fetched image attachments by attachment id (attachment-actions.ts).
  thumbs: Record<string, string>;
  // The settings screen's data, fetched when it opens; null until then.
  devices: Device[];
  settings: Settings | null;
}

export interface StoreOptions {
  storage: Storage;
  socket: SocketFactory;
  // Resolves to the browser's PushSubscription JSON. With `prompt` false it must not ask the
  // user for permission (there is no gesture to ask under) and resolves to null when it cannot
  // subscribe silently; with `prompt` true it rejects with a `ClientError` whose code says why
  // (`push_unsupported`, `push_denied`, `push_no_worker`, `push_failed`). Left out where push
  // can never work (the dev server, a browser without it): `state.push` then stays
  // `unavailable` and the status bar offers nothing.
  subscribePush?: (vapidPublicKey: string, prompt: boolean) => Promise<unknown>;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  // Runs `fn` after `ms` and returns a cancel; defaults to setTimeout. Tests inject one they fire.
  schedule?: (fn: () => void, ms: number) => () => void;
}

// Shared by the store's modules; never exposed to views.
export interface StoreInternals {
  options: StoreOptions;
  state: StoreState;
  logs: Map<string, SessionLog>;
  connection: Connection | null;
  sync: SyncSession | null;
  vapidPublicKey: string | null;
  refreshing: Promise<void> | null;
  // The id the box gave this device at pairing; a `device.revoked` notice naming it unpairs.
  deviceId: string | null;
  // Cancels the auto-clear of the shown action error, if one is pending.
  errorTimer: (() => void) | null;
  // The standing connection error, kept while an action error covers it (store-errors.ts).
  connectionError: StoreError | null;
  // The composer's files by chip key, off the reactive state (attachment-actions.ts).
  files: Map<string, File>;
  // Thumbnail fetches in flight or done, by attachment id, and which session each belongs to.
  thumbLoads: Map<string, Promise<void>>;
  thumbOwners: Map<string, Set<string>>;
}

// A fresh, empty state, before boot.
export const storeState = (): StoreState =>
  reactive({
    phase: 'booting',
    status: 'stopped',
    daemon: null,
    daemonVersion: null,
    error: null,
    push: 'unavailable',
    sessions: [],
    agents: ['claude'],
    rateWindows: [],
    logs: {},
    drafts: {},
    composers: {},
    thumbs: {},
    devices: [],
    settings: null,
  });
