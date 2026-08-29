import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentConfigFiles } from './create-agent-config.ts';
import { createAgentConfig } from './create-agent-config.ts';
import type { AskRegistry } from './create-ask-registry.ts';
import { createAskRegistry } from './create-ask-registry.ts';
import type { GitService } from './create-git-service.ts';
import { createGitService } from './create-git-service.ts';
import type { DaemonLock } from './acquire-daemon-lock.ts';
import { acquireDaemonLock } from './acquire-daemon-lock.ts';
import { openDatabase } from './open-database.ts';
import type { Stores } from './open-stores.ts';
import { openStores } from './open-stores.ts';
import type { Settled } from './settle-orphans.ts';
import { settleOrphans } from './settle-orphans.ts';

// Everything under the data directory plus the process-local services, opened together: the
// one SQLite file (ADR 0006), the worktrees directory, the agent's config files, the ask
// registry and the git service. Owning the directory (`lock`) and settling what a dead daemon
// left in it (`settle`) are the daemon's to call on start, not `flux devices`', which opens
// the same directory beside a running daemon.

export interface Services extends Stores {
  worktreesDir: string;
  agentConfig: AgentConfigFiles;
  asks: AskRegistry;
  git: GitService;
  // Refuses (`conflict`) while another daemon holds the directory (ADR 0017).
  lock: () => DaemonLock;
  settle: () => Settled;
  close: () => void;
}

export interface ServicesOptions {
  dataDir: string;
  // The flux user's `~/.claude`, where CLAUDE.md and settings.json live.
  claudeDir: string;
  // The environment's repositories directory; the settings store overrides it once one is set.
  reposDir: string;
}

export const openServices = (options: ServicesOptions): Services => {
  const worktreesDir = join(options.dataDir, 'worktrees');
  mkdirSync(worktreesDir, { recursive: true });
  const db = openDatabase(join(options.dataDir, 'flux.sqlite'));
  const asks = createAskRegistry();
  const stores = openStores(db, options.reposDir, join(options.dataDir, 'attachments'));
  return {
    ...stores,
    worktreesDir,
    agentConfig: createAgentConfig(options.claudeDir),
    asks,
    git: createGitService(),
    lock: () => acquireDaemonLock(options.dataDir),
    settle: () => settleOrphans(stores),
    close: () => {
      asks.close();
      db.close();
    },
  };
};
