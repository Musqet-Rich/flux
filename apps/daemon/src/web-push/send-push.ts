import type { Bytes } from '@flux/protocol';

import { encryptPush } from './encrypt-push.ts';
import type { VapidKeys } from './vapid-token.ts';
import { vapidToken } from './vapid-token.ts';

// One Web Push delivery (RFC 8030): encrypt for the subscription, sign for the service, POST.
// `gone` means the subscription is dead and should be forgotten; `failed` is transient.

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface SendPushOptions {
  target: PushTarget;
  payload: Bytes;
  vapid: VapidKeys;
  subject: string;
  ttlSeconds?: number;
  fetch?: typeof fetch;
}

export type PushOutcome = 'sent' | 'gone' | 'failed';

export const sendPush = async (options: SendPushOptions): Promise<PushOutcome> => {
  const { target, vapid, subject } = options;
  const doFetch = options.fetch ?? fetch;
  try {
    const [body, authorization] = await Promise.all([
      encryptPush({ keys: target.keys, plaintext: options.payload }),
      vapidToken({ keys: vapid, endpoint: target.endpoint, subject }),
    ]);
    const response = await doFetch(target.endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(options.ttlSeconds ?? 60),
        Urgency: 'high',
      },
      body,
    });
    if (response.status === 404 || response.status === 410) return 'gone';
    return response.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
};
