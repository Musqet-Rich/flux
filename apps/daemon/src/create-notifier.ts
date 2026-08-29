import type { FluxEvent } from '@flux/protocol';
import { base64url } from '@flux/protocol';

import type { PushStore } from './create-push-store.ts';
import type { VapidKeys } from './web-push/vapid-token.ts';
import { sendPush } from './web-push/send-push.ts';

// Decides which events reach the operator's lock screen (architecture.md § Notifications): an
// ask, a done/blocked notify, and a session going idle after running. Sends to every
// subscription, forgets the dead ones, never throws into the event path.

export interface Notifier {
  notify: (event: FluxEvent) => Promise<void>;
  // base64url of the raw VAPID public key, handed to devices in `hello`.
  vapidPublicKey: string;
}

export interface NotifierOptions {
  push: PushStore;
  subject: string;
  fetch?: typeof fetch;
}

export interface PushMessage {
  session: string;
  type: FluxEvent['type'];
  summary: string;
}

const text = new TextEncoder();

// Returns the message to push for this event, or null when it is not worth a notification.
const messageFor = (
  event: FluxEvent,
  wasRunning: (session: string) => boolean,
): PushMessage | null => {
  const base = { session: event.session, type: event.type };
  if (event.type === 'ask') return { ...base, summary: event.payload.question };
  if (event.type === 'notify' && event.payload.level !== 'info') {
    return { ...base, summary: event.payload.summary };
  }
  if (
    event.type === 'session.state' &&
    event.payload.state === 'idle' &&
    wasRunning(event.session)
  ) {
    return { ...base, summary: 'Agent finished' };
  }
  return null;
};

export const createNotifier = async (options: NotifierOptions): Promise<Notifier> => {
  const vapid: VapidKeys = await options.push.vapid();
  const running = new Set<string>();
  const track = (event: FluxEvent): boolean => {
    const was = running.has(event.session);
    if (event.type === 'session.state') {
      if (event.payload.state === 'running') running.add(event.session);
      else running.delete(event.session);
    }
    return was;
  };
  return {
    vapidPublicKey: base64url.encode(vapid.publicKey),
    notify: async (event) => {
      const was = track(event);
      const message = messageFor(event, () => was);
      if (message === null) return;
      const payload = text.encode(JSON.stringify(message));
      const fetchOption = options.fetch === undefined ? {} : { fetch: options.fetch };
      await Promise.all(
        options.push.all().map(async (target) => {
          const outcome = await sendPush({
            target,
            payload,
            vapid,
            subject: options.subject,
            ...fetchOption,
          });
          if (outcome === 'gone') options.push.remove(target.endpoint);
        }),
      );
    },
  };
};
