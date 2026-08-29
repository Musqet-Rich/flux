import { createIndexedDbStorage } from '../client/create-indexed-db-storage.ts';
import { socket } from '../client/socket.ts';
import { subscribePush } from '../push/subscribe-push.ts';
import type { Store } from './create-store.ts';
import { createStore } from './create-store.ts';

// The browser's store: IndexedDB, the native WebSocket and the service worker's push manager.
// Components import this; tests build their own with createStore.

export const appStore: Store = createStore({
  storage: createIndexedDbStorage(),
  socket,
  subscribePush,
});
