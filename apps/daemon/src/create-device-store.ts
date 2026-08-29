import type { Bytes } from '@flux/protocol';
import { bytes, handshake, pairing } from '@flux/protocol';
import type { DatabaseSync } from 'node:sqlite';

import { DaemonError } from './daemon-error.ts';

// The box's identity and its trust list (protocol.md § 1, ADR 0012): the static X25519 keypair,
// paired device public keys, and the live one-time pairing secrets. Secrets are memory only.

export interface Device {
  deviceId: string;
  publicKey: Bytes;
  name: string;
  pairedAt: string;
  lastSeenAt: string | null;
}

export interface BoxIdentity {
  publicKey: Bytes;
  privateKey: CryptoKey;
}

export interface DeviceStore {
  identity: () => Promise<BoxIdentity>;
  devices: () => Device[];
  deviceByKey: (publicKey: Bytes) => Device | null;
  remove: (deviceId: string) => void;
  // Records that the device said hello just now.
  touch: (deviceId: string) => void;
  newSecret: () => Bytes;
  // Verifies a pairing proof against every live secret; burns the secret on success and
  // after three failures. Returns the new device, or null if no secret matched.
  pair: (devPub: Bytes, proof: Bytes, name: string) => Promise<Device | null>;
}

export interface DeviceStoreOptions {
  db: DatabaseSync;
  now?: () => Date;
  secretTtlMs?: number;
}

interface Secret {
  value: Bytes;
  expiresAt: number;
  failures: number;
}

const defaultTtlMs = 10 * 60 * 1000;
const maxFailures = 3;

const toBytes = (value: unknown): Bytes => {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  throw new DaemonError('internal', 'expected a blob column');
};

const toDevice = (row: Record<string, unknown>): Device => ({
  deviceId: String(row['device_id']),
  publicKey: toBytes(row['public_key']),
  name: String(row['name']),
  pairedAt: String(row['paired_at']),
  lastSeenAt: typeof row['last_seen_at'] === 'string' ? row['last_seen_at'] : null,
});

interface State {
  db: DatabaseSync;
  now: () => Date;
  ttl: number;
  secrets: Secret[];
  identity: Promise<BoxIdentity> | null;
}

const statements = (db: DatabaseSync) => ({
  selectAll: db.prepare('SELECT * FROM devices ORDER BY paired_at'),
  selectByKey: db.prepare('SELECT * FROM devices WHERE public_key = ?'),
  insert: db.prepare(
    'INSERT INTO devices (device_id, public_key, name, paired_at) VALUES (?, ?, ?, ?)',
  ),
  remove: db.prepare('DELETE FROM devices WHERE device_id = ?'),
  touch: db.prepare('UPDATE devices SET last_seen_at = ? WHERE device_id = ?'),
});

// Drops expired secrets and returns the live list (the same array, mutated in place).
const live = (state: State): Secret[] => {
  const t = state.now().getTime();
  for (let i = state.secrets.length - 1; i >= 0; i--) {
    if ((state.secrets[i]?.expiresAt ?? 0) <= t) state.secrets.splice(i, 1);
  }
  return state.secrets;
};

const loadOrCreateIdentity = async (db: DatabaseSync): Promise<BoxIdentity> => {
  const row = db.prepare('SELECT public_key, private_key FROM box_keys WHERE id = 1').get();
  if (row !== undefined) {
    return {
      publicKey: toBytes(row['public_key']),
      privateKey: await handshake.importPrivateKey(toBytes(row['private_key'])),
    };
  }
  const pair = await handshake.generateKeyPair(true);
  const privateKey = await handshake.exportPrivateKey(pair.privateKey);
  db.prepare('INSERT INTO box_keys (id, public_key, private_key) VALUES (1, ?, ?)').run(
    pair.publicKey,
    privateKey,
  );
  return { publicKey: pair.publicKey, privateKey: pair.privateKey };
};

const register = (
  state: State,
  st: ReturnType<typeof statements>,
  devPub: Bytes,
  name: string,
): Device => {
  const existing = st.selectByKey.get(devPub);
  if (existing !== undefined) return toDevice(existing);
  const device = {
    deviceId: crypto.randomUUID(),
    publicKey: devPub,
    name,
    pairedAt: state.now().toISOString(),
    lastSeenAt: null,
  };
  st.insert.run(device.deviceId, device.publicKey, device.name, device.pairedAt);
  return device;
};

const pairDevice = async (
  state: State,
  st: ReturnType<typeof statements>,
  boxPub: Bytes,
  devPub: Bytes,
  proof: Bytes,
  name: string,
): Promise<Device | null> => {
  // A copy: burning a secret splices the live list while this iterates.
  const candidates = [...live(state)];
  const checks = await Promise.all(
    candidates.map((secret) => pairing.verify(secret.value, devPub, boxPub, proof)),
  );
  const matched = candidates.find((_, i) => checks[i] === true);
  // Every secret that did not match takes a failure; three failures burn it.
  for (const secret of candidates) {
    if (secret === matched) continue;
    secret.failures += 1;
    if (secret.failures >= maxFailures) state.secrets.splice(state.secrets.indexOf(secret), 1);
  }
  if (matched === undefined) return null;
  state.secrets.splice(state.secrets.indexOf(matched), 1);
  return register(state, st, devPub, name);
};

export const createDeviceStore = (options: DeviceStoreOptions): DeviceStore => {
  const state: State = {
    db: options.db,
    now: options.now ?? ((): Date => new Date()),
    ttl: options.secretTtlMs ?? defaultTtlMs,
    secrets: [],
    identity: null,
  };
  const st = statements(options.db);
  const identity = (): Promise<BoxIdentity> => {
    state.identity ??= loadOrCreateIdentity(state.db);
    return state.identity;
  };
  return {
    identity,
    devices: () => st.selectAll.all().map((row) => toDevice(row)),
    deviceByKey: (publicKey) => {
      const row = st.selectByKey.get(publicKey);
      return row === undefined ? null : toDevice(row);
    },
    remove: (deviceId) => {
      if (st.remove.run(deviceId).changes === 0) {
        throw new DaemonError('not_found', `no device ${deviceId}`);
      }
    },
    touch: (deviceId) => {
      st.touch.run(state.now().toISOString(), deviceId);
    },
    newSecret: () => {
      const value = bytes.random(pairing.secretLength);
      live(state).push({ value, expiresAt: state.now().getTime() + state.ttl, failures: 0 });
      return value;
    },
    pair: async (devPub, proof, name) =>
      pairDevice(state, st, (await identity()).publicKey, devPub, proof, name),
  };
};
