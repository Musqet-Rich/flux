import type { Bytes } from '@flux/protocol';
import { guards } from '@flux/protocol';
import type { DatabaseSync } from 'node:sqlite';

import { DaemonError } from './daemon-error.ts';
import type { VapidKeys } from './web-push/vapid-token.ts';

// Web Push subscriptions, one row per endpoint, and the box's VAPID signing key (architecture.md
// § Notifications). The box holds them because it is the one that sends pushes (ADR 0013).

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushStore {
  put: (deviceId: string, subscription: unknown) => PushSubscription;
  all: () => PushSubscription[];
  remove: (endpoint: string) => void;
  // Drops every subscription a device stored; part of revoking it.
  removeDevice: (deviceId: string) => void;
  // The VAPID P-256 key, generated on first use and kept in box_keys next to the identity.
  vapid: () => Promise<VapidKeys>;
}

const ecdsa = { name: 'ECDSA', namedCurve: 'P-256' };

const toBytes = (value: unknown): Bytes =>
  value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(0);

const loadOrCreateVapid = async (db: DatabaseSync): Promise<VapidKeys> => {
  const row = db.prepare('SELECT vapid_public, vapid_private FROM box_keys WHERE id = 1').get();
  if (row === undefined) throw new DaemonError('internal', 'box identity missing');
  if (row['vapid_public'] !== null) {
    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      toBytes(row['vapid_private']),
      ecdsa,
      false,
      ['sign'],
    );
    return { publicKey: toBytes(row['vapid_public']), privateKey };
  }
  const pair = await crypto.subtle.generateKey(ecdsa, true, ['sign', 'verify']);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  db.prepare('UPDATE box_keys SET vapid_public = ?, vapid_private = ? WHERE id = 1').run(
    publicKey,
    pkcs8,
  );
  return { publicKey, privateKey: pair.privateKey };
};

const { isString, isRecord } = guards;

// The browser's PushSubscription.toJSON(): endpoint plus the two keys; anything else is dropped.
const isSubscription = (v: unknown): v is PushSubscription =>
  isRecord(v) &&
  isString(v['endpoint']) &&
  isRecord(v['keys']) &&
  isString(v['keys']['p256dh']) &&
  isString(v['keys']['auth']);

const normalise = (value: unknown): PushSubscription | null =>
  isSubscription(value)
    ? { endpoint: value.endpoint, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } }
    : null;

export const createPushStore = (db: DatabaseSync): PushStore => {
  const upsert = db.prepare(
    'INSERT OR REPLACE INTO push_subscriptions (endpoint, subscription, device_id) VALUES (?, ?, ?)',
  );
  const selectAll = db.prepare('SELECT subscription FROM push_subscriptions');
  const del = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?');
  const delDevice = db.prepare('DELETE FROM push_subscriptions WHERE device_id = ?');
  return {
    put: (deviceId, subscription) => {
      const clean = normalise(subscription);
      if (clean === null) throw new TypeError('not a push subscription');
      upsert.run(clean.endpoint, JSON.stringify(clean), deviceId);
      return clean;
    },
    all: () =>
      selectAll
        .all()
        .map((row) => normalise(JSON.parse(String(row['subscription']))))
        .filter((s): s is PushSubscription => s !== null),
    remove: (endpoint) => {
      del.run(endpoint);
    },
    removeDevice: (deviceId) => {
      delDevice.run(deviceId);
    },
    vapid: () => loadOrCreateVapid(db),
  };
};
