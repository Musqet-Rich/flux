// Whether this page can subscribe to Web Push at all: the browser has to have a service worker
// and a push manager, and the dev server registers no worker (main.ts), so under it
// `serviceWorker.ready` would never settle.

const available = (): boolean =>
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window &&
  !import.meta.env.DEV;

// Where a daemon's own service worker is registered (ADR 0037): the same /sw.js under a scope of
// its own, so each daemon's subscription has a worker of its own (a browser keeps one
// subscription per worker, tied to one sender's key) and the worker knows from its scope which
// daemon a push came from (sw.ts reads it back). No page lives under the scope; it is a name.
const scope = (daemon: string): string => `/push/${encodeURIComponent(daemon)}/`;

export const pushSupport: { available: typeof available; scope: typeof scope } = {
  available,
  scope,
};
