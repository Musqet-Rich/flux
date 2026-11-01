import { beforeAll, expect, test, vi } from 'vitest';

import type { WorkerScope } from './sw.ts';
import { sw } from './sw.ts';

// The service worker as a daemon's own worker (ADR 0037): its scope names the daemon, so its
// notifications are tagged with it, and a tap tells an open window which daemon and session to
// open, or opens a new window with the daemon in the query. Installed on a fake scope.

type Listener = (event: unknown) => void;

const listeners = new Map<string, Listener>();
const showNotification = vi.fn<(title: string, options: object) => Promise<void>>(() =>
  Promise.resolve(),
);
const windows: {
  focus: () => Promise<unknown>;
  navigate: (url: string) => Promise<unknown>;
  postMessage: (m: unknown) => void;
}[] = [];
const openWindow = vi.fn<(url: string) => Promise<unknown>>(() => Promise.resolve(null));
const focus = vi.fn<() => Promise<unknown>>(() => Promise.resolve(null));
const postMessage = vi.fn<(message: unknown) => void>();

beforeAll(() => {
  const scope: WorkerScope = {
    registration: { scope: 'https://app.example/push/abc/', showNotification },
    clients: { matchAll: () => Promise.resolve(windows), openWindow },
    // The scope types each event; the test hands them plain objects, so it keeps them untyped.
    addEventListener: (type: string, listener: (event: never) => void) => {
      listeners.set(type, listener as Listener);
    },
  };
  sw.install(scope);
});

const settle = async (fire: (waitUntil: (p: Promise<unknown>) => void) => void): Promise<void> => {
  const pending: Promise<unknown>[] = [];
  fire((p) => {
    pending.push(p);
  });
  await Promise.all(pending);
};

test("a push is shown under a tag naming the worker's daemon", async () => {
  await settle((waitUntil) => {
    listeners.get('push')?.({
      data: { json: () => ({ session: 's1', type: 'ask', summary: 'Which one?' }) },
      waitUntil,
    });
  });
  expect(showNotification).toHaveBeenCalledWith('Agent needs you', {
    body: 'Which one?',
    tag: 'abc:s1',
    data: { session: 's1' },
  });
});

test('a tap opens a new window at the session with the daemon in the query', async () => {
  await settle((waitUntil) => {
    listeners.get('notificationclick')?.({
      notification: { close: () => null, data: { session: 's1' } },
      waitUntil,
    });
  });
  expect(openWindow).toHaveBeenCalledWith('/s/s1?daemon=abc');
});

test('a tap with the app open tells its window to open the daemon and the session', async () => {
  windows.push({ focus, navigate: () => Promise.resolve(null), postMessage });
  await settle((waitUntil) => {
    listeners.get('notificationclick')?.({
      notification: { close: () => null, data: { session: 's1' } },
      waitUntil,
    });
  });
  expect(focus).toHaveBeenCalled();
  expect(postMessage).toHaveBeenCalledWith({ type: 'flux.open', daemon: 'abc', session: 's1' });
  expect(openWindow).toHaveBeenCalledTimes(1);
});
