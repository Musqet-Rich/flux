import type { FluxSettings } from '@flux/protocol';
import { settings } from '@flux/protocol';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { DaemonError } from './daemon-error.ts';

// The box's runtime settings (protocol.md § 7, `settings.get`/`settings.set`), one JSON row in
// the `settings` table. Anything not stored falls back to the defaults below, so a fresh box
// behaves exactly as before the operator touched anything.

export interface SettingsStore {
  get: () => FluxSettings;
  // Throws bad_params for a patch `set` would refuse.
  check: (patch: Partial<FluxSettings>) => void;
  set: (patch: Partial<FluxSettings>) => FluxSettings;
}

export interface SettingsStoreOptions {
  db: DatabaseSync;
  // The environment's repositories directory, the default until one is stored.
  reposDir: string;
}

const key = 'flux';

const defaults = (reposDir: string): FluxSettings => ({
  reposDir,
  defaultHarness: 'claude',
  notifyOnAsk: true,
  notifyOnIdle: true,
  notifyOnDone: true,
});

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
  defaultHarness: patch.defaultHarness ?? base.defaultHarness,
  notifyOnAsk: patch.notifyOnAsk ?? base.notifyOnAsk,
  notifyOnIdle: patch.notifyOnIdle ?? base.notifyOnIdle,
  notifyOnDone: patch.notifyOnDone ?? base.notifyOnDone,
});

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

// An absolute, normalised path (no trailing slash, no `..`) to an existing directory; anything
// else would break every `sessions.create` until it was changed back.
const cleanReposDir = (patch: Partial<FluxSettings>): Partial<FluxSettings> => {
  if (patch.reposDir === undefined) return patch;
  if (!patch.reposDir.startsWith('/')) {
    throw new DaemonError('bad_params', 'reposDir must be an absolute path');
  }
  const reposDir = resolve(patch.reposDir);
  if (!isDirectory(reposDir)) {
    throw new DaemonError('bad_params', `reposDir ${reposDir} is not a directory`);
  }
  return { ...patch, reposDir };
};

export const createSettingsStore = (options: SettingsStoreOptions): SettingsStore => {
  const select = options.db.prepare('SELECT value FROM settings WHERE key = ?');
  const upsert = options.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const base = defaults(options.reposDir);
  const get = (): FluxSettings => merge(base, parse(select.get(key)?.['value']));
  return {
    get,
    check: (patch) => {
      cleanReposDir(patch);
    },
    set: (patch) => {
      const next = merge(get(), cleanReposDir(patch));
      upsert.run(key, JSON.stringify(next));
      return next;
    },
  };
};
