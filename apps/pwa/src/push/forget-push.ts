import { pushSupport } from './push-support.ts';

// Lets one daemon's push subscription go (ADR 0037): the browser unsubscribes, so the daemon's
// next push finds the endpoint gone and the daemon drops it, and the daemon's own worker is
// unregistered. `null` is the root worker, which also serves the app's pages and stays; only the
// subscription the app made there, before each daemon had a worker of its own, is let go.

export const forgetPush = async (daemon: string | null): Promise<void> => {
  if (!pushSupport.available()) return;
  const path = daemon === null ? '/' : pushSupport.scope(daemon);
  const scope = new URL(path, location.origin).href;
  const registrations = await navigator.serviceWorker.getRegistrations();
  const registration = registrations.find((r) => r.scope === scope);
  if (registration === undefined) return;
  const subscription = await registration.pushManager.getSubscription();
  await subscription?.unsubscribe();
  if (daemon !== null) await registration.unregister();
};
