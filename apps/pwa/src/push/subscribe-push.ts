import { base64url } from '@flux/protocol';

// Subscribes this device to Web Push through the registered service worker (architecture.md
// § Notifications). Resolves to null wherever push is unavailable or refused, so the store can
// carry on without it. Without `prompt` it only proceeds when permission is already granted:
// `pushManager.subscribe` shows the permission dialog, which browsers quiet or block unless a
// user gesture is behind it.

export const subscribePush = async (vapidPublicKey: string, prompt: boolean): Promise<unknown> => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  if (!prompt && Notification.permission !== 'granted') return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64url.decode(vapidPublicKey),
    });
    return subscription.toJSON();
  } catch {
    return null;
  }
};
