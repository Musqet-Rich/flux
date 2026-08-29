import { guards } from '@flux/protocol';
import type { DatabaseSync } from 'node:sqlite';

// Web Push subscriptions, one row per endpoint (architecture.md § Notifications). The box
// holds them because it is the one that sends pushes (ADR 0013); the relay never sees them.

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushStore {
  put: (deviceId: string, subscription: unknown) => PushSubscription;
  all: () => PushSubscription[];
  remove: (endpoint: string) => void;
}

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
  };
};
