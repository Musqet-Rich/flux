// Whether this page can subscribe to Web Push at all: the browser has to have a service worker
// and a push manager, and the dev server registers no worker (main.ts), so under it
// `serviceWorker.ready` would never settle.

const available = (): boolean =>
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window &&
  !import.meta.env.DEV;

export const pushSupport: { available: typeof available } = { available };
