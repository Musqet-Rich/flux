import { base64url } from '@flux/protocol';

import { ClientError } from '../client/client-error.ts';
import { pushSupport } from './push-support.ts';

// Subscribes this device to Web Push for one daemon (architecture.md § Notifications), through
// that daemon's own service worker (ADR 0037, push-support.ts `scope`), registered here the
// first time it is needed. Without `prompt` it only proceeds when permission is already granted
// and resolves to null on any refusal, so the store carries on without push:
// `pushManager.subscribe` shows the permission dialog, which browsers quiet or block unless a
// user gesture is behind it. With `prompt` (a tap on "Enable notifications") a refusal is a
// `ClientError` that names why, so the status bar can say so instead of the tap doing nothing.

const workerWaitMs = 5000;

// A worker only takes a subscription once it is active, and a fresh registration installs and
// activates on its own; a worker that fails to install never gets there.
const activation = (registration: ServiceWorkerRegistration): Promise<boolean> =>
  new Promise((resolve) => {
    const worker = registration.installing ?? registration.waiting;
    if (registration.active !== null || worker === null) {
      resolve(registration.active !== null);
      return;
    }
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') resolve(true);
      if (worker.state === 'redundant') resolve(false);
    });
  });

const register = async (daemon: string): Promise<ServiceWorkerRegistration> => {
  const scope = new URL(pushSupport.scope(daemon), location.origin).href;
  const registrations = await navigator.serviceWorker.getRegistrations();
  return (
    registrations.find((r) => r.scope === scope) ??
    navigator.serviceWorker.register('/sw.js', { type: 'module', scope })
  );
};

// A registration that never activates (or never registers) would leave the subscribe waiting
// for ever; a bounded wait turns that into an error the operator can act on.
const readyWorker = async (daemon: string): Promise<ServiceWorkerRegistration | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null);
    }, workerWaitMs);
  });
  const ready = async (): Promise<ServiceWorkerRegistration | null> => {
    const registration = await register(daemon).catch(() => null);
    if (registration === null) return null;
    return (await activation(registration)) ? registration : null;
  };
  try {
    return await Promise.race([ready(), gaveUp]);
  } finally {
    clearTimeout(timer);
  }
};

const subscribe = async (vapidPublicKey: string, daemon: string): Promise<unknown> => {
  if (!pushSupport.available()) {
    throw new ClientError('push_unsupported', 'This browser cannot receive notifications here.');
  }
  if (Notification.permission === 'denied') {
    throw new ClientError('push_denied', 'Notifications are blocked for this site in the browser.');
  }
  const registration = await readyWorker(daemon);
  if (registration === null) {
    throw new ClientError('push_no_worker', 'Notifications are not ready; reload and try again.');
  }
  try {
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64url.decode(vapidPublicKey),
    });
    return subscription.toJSON();
  } catch (error) {
    if (error instanceof Error && error.name === 'NotAllowedError') {
      throw new ClientError('push_denied', 'Notification permission was not granted.');
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new ClientError('push_failed', `Could not subscribe to notifications: ${detail}`);
  }
};

export const subscribePush = async (
  vapidPublicKey: string,
  prompt: boolean,
  daemon: string,
): Promise<unknown> => {
  if (prompt) return subscribe(vapidPublicKey, daemon);
  if (!pushSupport.available() || Notification.permission !== 'granted') return null;
  return subscribe(vapidPublicKey, daemon).catch(() => null);
};
