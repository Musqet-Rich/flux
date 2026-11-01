// Service worker (architecture.md § Notifications): shows the box's push notifications and
// opens the session on tap. Built by Vite as its own module entry, emitted as /sw.js, so it
// is type-checked and linted like the rest of the app. The daemon sends { session, type,
// summary? } and nothing else. No fetch caching at P1: without the box there is nothing to show.
//
// The same script runs as the root worker, which serves the app's pages, and as each paired
// daemon's own worker under `/push/<daemon>/` (ADR 0037, push-support.ts), where that daemon's
// push subscription lives. The scope is how a worker knows whose push it is showing, so a tap
// opens the session on the right daemon: an open window is told to switch to it (App.vue), and
// a new one is opened at the session with the daemon in its query, for boot to open first.
//
// The DOM lib has no worker-scope types, so the slice of ServiceWorkerGlobalScope used here is
// described structurally and `globalThis` is checked against it once.

interface PushData {
  json: () => unknown;
}

interface PushEvent extends Event {
  data: PushData | null;
  waitUntil: (p: Promise<unknown>) => void;
}

interface NotificationClickEvent extends Event {
  notification: { close: () => void; data: unknown };
  waitUntil: (p: Promise<unknown>) => void;
}

interface WindowClient {
  focus: () => Promise<unknown>;
  navigate: (url: string) => Promise<unknown>;
  postMessage: (message: unknown) => void;
}

export interface WorkerScope {
  registration: {
    scope: string;
    showNotification: (title: string, options: object) => Promise<void>;
  };
  clients: {
    matchAll: (options: object) => Promise<WindowClient[]>;
    openWindow: (url: string) => Promise<unknown>;
  };
  addEventListener: {
    (type: 'push', listener: (event: PushEvent) => void): void;
    (type: 'notificationclick', listener: (event: NotificationClickEvent) => void): void;
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const isWorkerScope = (v: unknown): v is WorkerScope =>
  isRecord(v) && 'registration' in v && 'clients' in v;

const titles: Record<string, string> = {
  ask: 'Agent needs you',
  notify: 'Agent update',
  'session.state': 'Agent finished',
};

const parse = (event: PushEvent): Record<string, unknown> => {
  try {
    const data = event.data?.json();
    return isRecord(data) ? data : {};
  } catch {
    return {};
  }
};

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);

// The daemon whose worker this is, from its scope; null for the root worker.
const daemonOf = (scopeUrl: string): string | null => {
  const match = /^\/push\/([^/]+)\/$/u.exec(new URL(scopeUrl).pathname);
  const daemon = match?.[1];
  return daemon === undefined ? null : decodeURIComponent(daemon);
};

const urlFor = (session: string | null, daemon: string | null): string => {
  const path = session === null ? '/' : `/s/${encodeURIComponent(session)}`;
  return daemon === null ? path : `${path}?${new URLSearchParams({ daemon }).toString()}`;
};

const install = (scope: WorkerScope): void => {
  const daemon = daemonOf(scope.registration.scope);

  scope.addEventListener('push', (event) => {
    const data = parse(event);
    const session = text(data['session']);
    const title = titles[text(data['type']) ?? ''] ?? 'Flux';
    const body = text(data['summary']) ?? '';
    // Two daemons may each have a session of the same id; the tag keeps their notices apart.
    const tag = session ?? 'flux';
    event.waitUntil(
      scope.registration.showNotification(title, {
        body,
        tag: daemon === null ? tag : `${daemon}:${tag}`,
        data: { session },
      }),
    );
  });

  // An open window is told which daemon and session to open: a daemon's worker controls no
  // page, so it cannot navigate one, and the app opens it without a reload. The root worker
  // navigates its window as before.
  const open = async (session: string | null): Promise<void> => {
    const url = urlFor(session, daemon);
    const [existing] = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (existing === undefined) {
      await scope.clients.openWindow(url);
      return;
    }
    await existing.focus();
    if (daemon !== null) {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's Client.postMessage has no target origin: it only ever reaches that same-origin window
      existing.postMessage({ type: 'flux.open', daemon, session });
      return;
    }
    // navigate() is refused for a window the worker does not control (e.g. a cross-origin
    // page in the same tab group); a fresh window is the fallback.
    await existing.navigate(url).catch(() => scope.clients.openWindow(url));
  };

  scope.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const data: unknown = event.notification.data;
    event.waitUntil(open(isRecord(data) ? text(data['session']) : null));
  });
};

const scope: unknown = globalThis;
if (isWorkerScope(scope)) install(scope);

// What a test drives with a fake scope; the worker itself only ever installs on its own.
export const sw: { install: typeof install } = { install };
