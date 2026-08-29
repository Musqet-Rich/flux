import { base64url } from '@flux/protocol';

import { ClientError } from '../client/client-error.ts';
import { pushSupport } from './push-support.ts';

// Subscribes this device to Web Push through the registered service worker (architecture.md
// § Notifications). Without `prompt` it only proceeds when permission is already granted and
// resolves to null on any refusal, so the store carries on without push: `pushManager.subscribe`
// shows the permission dialog, which browsers quiet or block unless a user gesture is behind it.
// With `prompt` (a tap on "Enable notifications") a refusal is a `ClientError` that names why,
// so the status bar can say so instead of the tap doing nothing.

const workerWaitMs = 5000;

// `serviceWorker.ready` never settles when no worker is registered; a bounded wait turns that
// into an error the operator can act on.
const readyWorker = async (): Promise<ServiceWorkerRegistration | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null);
    }, workerWaitMs);
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, gaveUp]);
  } finally {
    clearTimeout(timer);
  }
};

const subscribe = async (vapidPublicKey: string): Promise<unknown> => {
  if (!pushSupport.available()) {
    throw new ClientError('push_unsupported', 'This browser cannot receive notifications here.');
  }
  if (Notification.permission === 'denied') {
    throw new ClientError('push_denied', 'Notifications are blocked for this site in the browser.');
  }
  const registration = await readyWorker();
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

export const subscribePush = async (vapidPublicKey: string, prompt: boolean): Promise<unknown> => {
  if (prompt) return subscribe(vapidPublicKey);
  if (!pushSupport.available() || Notification.permission !== 'granted') return null;
  return subscribe(vapidPublicKey).catch(() => null);
};
