import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { AskRegistry } from './create-ask-registry.ts';
import { createAskRegistry } from './create-ask-registry.ts';
import type { CommentStore } from './create-comment-store.ts';
import { createCommentStore } from './create-comment-store.ts';
import type { DeviceStore } from './create-device-store.ts';
import { createDeviceStore } from './create-device-store.ts';
import type { EventLog } from './create-event-log.ts';
import { createEventLog } from './create-event-log.ts';
import type { GitService } from './create-git-service.ts';
import { createGitService } from './create-git-service.ts';
import type { PushStore } from './create-push-store.ts';
import { createPushStore } from './create-push-store.ts';
import type { SessionStore } from './create-session-store.ts';
import { createSessionStore } from './create-session-store.ts';
import { openDatabase } from './open-database.ts';

// Everything under the data directory plus the process-local services, opened together: the
// one SQLite file (ADR 0006), the worktrees directory, the ask registry and the git service.

export interface Services {
  worktreesDir: string;
  log: EventLog;
  sessions: SessionStore;
  devices: DeviceStore;
  comments: CommentStore;
  push: PushStore;
  asks: AskRegistry;
  git: GitService;
  close: () => void;
}

export const openServices = (dataDir: string): Services => {
  const worktreesDir = join(dataDir, 'worktrees');
  mkdirSync(worktreesDir, { recursive: true });
  const db = openDatabase(join(dataDir, 'flux.sqlite'));
  const log = createEventLog({ db });
  const asks = createAskRegistry();
  return {
    worktreesDir,
    log,
    sessions: createSessionStore({ db, lastSeq: log.lastSeq }),
    devices: createDeviceStore({ db }),
    comments: createCommentStore(db),
    push: createPushStore(db),
    asks,
    git: createGitService(),
    close: () => {
      asks.close();
      db.close();
    },
  };
};
