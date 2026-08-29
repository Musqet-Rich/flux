import type { FluxSettings } from '@flux/protocol';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentConfigFiles } from './create-agent-config.ts';
import { createAgentConfig } from './create-agent-config.ts';
import type { AskRegistry } from './create-ask-registry.ts';
import { createAskRegistry } from './create-ask-registry.ts';
import type { GitService } from './create-git-service.ts';
import { createGitService } from './create-git-service.ts';
import { openDatabase } from './open-database.ts';
import type { Stores } from './open-stores.ts';
import { openStores } from './open-stores.ts';

// Everything under the data directory plus the process-local services, opened together: the
// one SQLite file (ADR 0006), the worktrees directory, the agent's config files, the ask
// registry and the git service.

export interface Services extends Stores {
  worktreesDir: string;
  agentConfig: AgentConfigFiles;
  asks: AskRegistry;
  git: GitService;
  close: () => void;
}

export interface ServicesOptions {
  dataDir: string;
  // The flux user's `~/.claude`, where CLAUDE.md and settings.json live.
  claudeDir: string;
  // What the environment configured; the settings store overrides these once set.
  defaults: FluxSettings;
}

export const openServices = (options: ServicesOptions): Services => {
  const worktreesDir = join(options.dataDir, 'worktrees');
  mkdirSync(worktreesDir, { recursive: true });
  const db = openDatabase(join(options.dataDir, 'flux.sqlite'));
  const asks = createAskRegistry();
  return {
    ...openStores(db, options.defaults),
    worktreesDir,
    agentConfig: createAgentConfig(options.claudeDir),
    asks,
    git: createGitService(),
    close: () => {
      asks.close();
      db.close();
    },
  };
};
