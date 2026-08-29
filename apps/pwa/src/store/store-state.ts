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

export interface LogView {
  events: FluxEvent[];
  streaming: string;
  lastSeq: number;
}

export interface StoreState {
  phase: StorePhase;
  status: ConnectionStatus;
  daemon: string | null;
  error: string | null;
  sessions: SessionSummary[];
  rateWindows: RateWindow[];
  logs: Record<string, LogView>;
}

export interface StoreOptions {
  storage: Storage;
  socket: SocketFactory;
  // Resolves to the browser's PushSubscription JSON, or null when push is unavailable.
  subscribePush?: (vapidPublicKey: string) => Promise<unknown>;
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
  pushDone: boolean;
  refreshing: Promise<void> | null;
}

// A fresh, empty state, before boot.
export const storeState = (): StoreState =>
  reactive({
    phase: 'booting',
    status: 'stopped',
    daemon: null,
    error: null,
    sessions: [],
    rateWindows: [],
    logs: {},
  });
