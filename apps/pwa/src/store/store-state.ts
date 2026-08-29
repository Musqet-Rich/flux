import type { FluxEvent, RateWindow, SessionSummary } from '@flux/protocol';
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

export interface LogView {
  events: FluxEvent[];
  streaming: string;
  lastSeq: number;
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
  rateWindows: RateWindow[];
  logs: Record<string, LogView>;
  drafts: Record<string, Draft>;
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
    rateWindows: [],
    logs: {},
    drafts: {},
  });
