import type { FluxSettings } from '@flux/protocol';
import { settings } from '@flux/protocol';
import type { DatabaseSync } from 'node:sqlite';

import { DaemonError } from './daemon-error.ts';

// The box's runtime settings (protocol.md § 7, `settings.get`/`settings.set`), one JSON row in
// the `settings` table. Anything not stored falls back to the defaults the environment gave the
// daemon at start, so a fresh box behaves exactly as before the operator touched anything.

export interface SettingsStore {
  get: () => FluxSettings;
  set: (patch: Partial<FluxSettings>) => FluxSettings;
}

export interface SettingsStoreOptions {
  db: DatabaseSync;
  defaults: FluxSettings;
}

const key = 'flux';

const parse = (value: unknown): Partial<FluxSettings> => {
  if (typeof value !== 'string') return {};
  try {
    const wrapped: { flux: unknown } = { flux: JSON.parse(value) };
    return settings.isPatch(wrapped) ? (wrapped.flux ?? {}) : {};
  } catch {
    return {};
  }
};

// Field by field, so a stored row from another build carries nothing unknown into the result.
const merge = (base: FluxSettings, patch: Partial<FluxSettings>): FluxSettings => ({
  reposDir: patch.reposDir ?? base.reposDir,
  defaultAgent: patch.defaultAgent ?? base.defaultAgent,
  notifyOnAsk: patch.notifyOnAsk ?? base.notifyOnAsk,
  notifyOnIdle: patch.notifyOnIdle ?? base.notifyOnIdle,
  notifyOnDone: patch.notifyOnDone ?? base.notifyOnDone,
});

export const createSettingsStore = (options: SettingsStoreOptions): SettingsStore => {
  const select = options.db.prepare('SELECT value FROM settings WHERE key = ?');
  const upsert = options.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const get = (): FluxSettings => merge(options.defaults, parse(select.get(key)?.['value']));
  return {
    get,
    set: (patch) => {
      if (patch.reposDir !== undefined && !patch.reposDir.startsWith('/')) {
        throw new DaemonError('bad_params', 'reposDir must be an absolute path');
      }
      const next = merge(get(), patch);
      upsert.run(key, JSON.stringify(next));
      return next;
    },
  };
};
