import type { FluxSettings } from '@flux/protocol';
import type { DatabaseSync } from 'node:sqlite';

import type { CommentStore } from './create-comment-store.ts';
import { createCommentStore } from './create-comment-store.ts';
import type { DeviceStore } from './create-device-store.ts';
import { createDeviceStore } from './create-device-store.ts';
import type { EventLog } from './create-event-log.ts';
import { createEventLog } from './create-event-log.ts';
import type { PushStore } from './create-push-store.ts';
import { createPushStore } from './create-push-store.ts';
import type { SessionStore } from './create-session-store.ts';
import { createSessionStore } from './create-session-store.ts';
import type { SettingsStore } from './create-settings-store.ts';
import { createSettingsStore } from './create-settings-store.ts';

// Everything that lives in the one SQLite file (ADR 0006), opened over a database handle.

export interface Stores {
  log: EventLog;
  sessions: SessionStore;
  devices: DeviceStore;
  comments: CommentStore;
  push: PushStore;
  settings: SettingsStore;
}

export const openStores = (db: DatabaseSync, defaults: FluxSettings): Stores => {
  const log = createEventLog({ db });
  return {
    log,
    sessions: createSessionStore({ db, lastSeq: log.lastSeq }),
    devices: createDeviceStore({ db }),
    comments: createCommentStore(db),
    push: createPushStore(db),
    settings: createSettingsStore({ db, defaults }),
  };
};
