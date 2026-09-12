import { createIndexedDbStorage } from '../client/create-indexed-db-storage.ts';
import { socket } from '../client/socket.ts';
import { pushSupport } from '../push/push-support.ts';
import { subscribePush } from '../push/subscribe-push.ts';
import { createSoundPlayer } from '../sound/create-sound-player.ts';
import type { Store } from './create-store.ts';
import { createStore } from './create-store.ts';

// The browser's store: IndexedDB, the native WebSocket, the service worker's push manager and
// the Web Audio player. Components import this; tests build their own with createStore. Where
// push cannot work (the dev server registers no worker; a browser may lack push) the store gets
// no way to subscribe, so it never offers "Enable notifications".

const player = createSoundPlayer();

export const appStore: Store = createStore({
  storage: createIndexedDbStorage(),
  socket,
  ...(pushSupport.available() ? { subscribePush } : {}),
  playSound: player.play,
});

// Browsers only let a page start audio from inside a user gesture, and a notification arrives
// in none. The first tap anywhere unlocks the audio context for the rest of the page's life
// (create-sound-player.ts); a device with no sound chosen creates no context at all. `pointerup`
// rather than `pointerdown`: only the former counts as activation for a touch, and a phone is
// where this matters.
const prime = (): void => {
  if (appStore.state.sound !== 'none') player.prime();
};
document.addEventListener('pointerup', prime, { capture: true, passive: true });
document.addEventListener('keydown', prime, { capture: true, passive: true });
