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

export interface LogView {
  events: FluxEvent[];
  streaming: string;
  lastSeq: number;
  thinking: Thinking | null;
  // Bumps on every `vcs.changed` notice, so the changes screen knows to refetch.
  changes: number;
}

// Unsaved editor text, kept across navigation so leaving the editor loses nothing. Keyed by
// `session\0path`; `hash` is the file version the draft was typed over.
export interface Draft {
  hash: string;
  text: string;
}

export interface StoreState {
  phase: StorePhase;
  status: ConnectionStatus;
  daemon: string | null;
  error: string | null;
  push: PushState;
  sessions: SessionSummary[];
  // Agents the box can run, from `hello`; a daemon that predates the field has claude only.
  agents: AgentKind[];
  rateWindows: RateWindow[];
  logs: Record<string, LogView>;
  drafts: Record<string, Draft>;
  // The settings screen's data, fetched when it opens; null until then.
  devices: Device[];
  settings: Settings | null;
}

export interface StoreOptions {
  storage: Storage;
  socket: SocketFactory;
  // Resolves to the browser's PushSubscription JSON, or null when push is unavailable. With
  // `prompt` false it must not ask the user for permission (there is no gesture to ask under).
  subscribePush?: (vapidPublicKey: string, prompt: boolean) => Promise<unknown>;
  minBackoffMs?: number;
  maxBackoffMs?: number;
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
}

// A fresh, empty state, before boot.
export const storeState = (): StoreState =>
  reactive({
    phase: 'booting',
    status: 'stopped',
    daemon: null,
    error: null,
    push: 'unavailable',
    sessions: [],
    agents: ['claude'],
    rateWindows: [],
    logs: {},
    drafts: {},
    devices: [],
    settings: null,
  });
