import { guards } from '@flux/protocol';

// A tap on a notification from a daemon's own worker (sw.ts, ADR 0037) names the daemon and the
// session to open. An open window hears it as a message from the worker (`listen`); a window
// the worker had to open carries the daemon in its query instead (`fromQuery`), read before the
// router rewrites the address, so boot opens that daemon first.

export interface NotificationOpen {
  daemon: string;
  session: string | null;
}

const { isRecord, isString } = guards;

const isOpen = (v: unknown): v is NotificationOpen & { type: 'flux.open' } =>
  isRecord(v) &&
  v['type'] === 'flux.open' &&
  isString(v['daemon']) &&
  (v['session'] === null || isString(v['session']));

const listen = (onOpen: (open: NotificationOpen) => void): void => {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent<unknown>) => {
    const { data } = event;
    if (isOpen(data)) onOpen({ daemon: data.daemon, session: data.session });
  });
  // A listener added this way does not start the queue the way `onmessage` would.
  navigator.serviceWorker.startMessages();
};

const fromQuery = (search: string): string | undefined =>
  new URLSearchParams(search).get('daemon') ?? undefined;

export const notificationOpens: { listen: typeof listen; fromQuery: typeof fromQuery } = {
  listen,
  fromQuery,
};
