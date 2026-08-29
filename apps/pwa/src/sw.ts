// Service worker (architecture.md § Notifications): shows the box's push notifications and
// opens the session on tap. Built by Vite as its own module entry, emitted as /sw.js, so it
// is type-checked and linted like the rest of the app. The daemon sends { session, type,
// summary? } and nothing else. No fetch caching at P1: without the box there is nothing to show.
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
}

interface WorkerScope {
  registration: { showNotification: (title: string, options: object) => Promise<void> };
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

const install = (scope: WorkerScope): void => {
  scope.addEventListener('push', (event) => {
    const data = parse(event);
    const session = text(data['session']);
    const title = titles[text(data['type']) ?? ''] ?? 'Flux';
    const body = text(data['summary']) ?? '';
    event.waitUntil(
      scope.registration.showNotification(title, {
        body,
        tag: session ?? 'flux',
        data: { session },
      }),
    );
  });

  const open = async (url: string): Promise<void> => {
    const [existing] = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (existing === undefined) {
      await scope.clients.openWindow(url);
      return;
    }
    await existing.focus();
    await existing.navigate(url);
  };

  scope.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const data: unknown = event.notification.data;
    const session = isRecord(data) ? text(data['session']) : null;
    event.waitUntil(open(session === null ? '/' : `/s/${encodeURIComponent(session)}`));
  });
};

const scope: unknown = globalThis;
if (isWorkerScope(scope)) install(scope);
