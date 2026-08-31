import type { AgentSpec, FluxSettings } from '@flux/protocol';
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
  // Saved Agents (ADR 0023 § 2), stored as their own JSON row; `setAgents` replaces the whole
  // list. A malformed or foreign-build row reads as no Agents rather than throwing.
  getAgents: () => AgentSpec[];
  setAgents: (agents: AgentSpec[]) => AgentSpec[];
  // First-run seeding of the default Agents (the "Help" Agent). Runs once ever, guarded by a
  // marker row: it adds "Help" only when no Agent of that name exists, and never re-adds it after
  // the operator deletes it — so it neither clobbers an operator's edits nor resurrects a deletion.
  seedDefaults: () => void;
}

export interface SettingsStoreOptions {
  db: DatabaseSync;
  // The environment's repositories directory, the default until one is stored.
  reposDir: string;
}

const key = 'flux';
const agentsKey = 'agents';
const seededKey = 'defaults_seeded';

// The default "Help" Agent seeded on first run: a read-only assistant that answers the operator's
// questions about flux from the bundled manual (via flux_help) and cannot touch the box. Its `deny`
// tools strip Bash/Edit/Write; the Flux-tools floor (incl. flux_help) survives every mode (ADR 0023
// § 5), so it can still reach the operator and look things up.
const helpAgent: AgentSpec = {
  name: 'Help',
  harness: 'claude',
  role: "You are the flux help agent. Answer the operator's natural-language questions about flux plainly and briefly. Use the flux_help tool to look things up in the manual rather than guessing. You cannot change their machine.",
  tools: { mode: 'deny', list: ['Bash', 'Edit', 'Write'] },
};

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

// The saved-Agents row, validated whole through the protocol guard; an unknown key or a bad
// element reads as no Agents rather than corrupting the list.
const parseAgents = (value: unknown): AgentSpec[] => {
  if (typeof value !== 'string') return [];
  try {
    const wrapped: { agents: unknown } = { agents: JSON.parse(value) };
    return settings.isPatch(wrapped) ? (wrapped.agents ?? []) : [];
  } catch {
    return [];
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
  const getAgents = (): AgentSpec[] => parseAgents(select.get(agentsKey)?.['value']);
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
    getAgents,
    setAgents: (agents) => {
      upsert.run(agentsKey, JSON.stringify(agents));
      return agents;
    },
    seedDefaults: () => {
      if (select.get(seededKey) !== undefined) return;
      upsert.run(seededKey, '1');
      const agents = getAgents();
      if (!agents.some((agent) => agent.name === helpAgent.name)) {
        upsert.run(agentsKey, JSON.stringify([helpAgent, ...agents]));
      }
    },
  };
};
