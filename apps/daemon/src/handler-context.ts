import type { AskRegistry } from './create-ask-registry.ts';
import type { CommentStore } from './create-comment-store.ts';
import type { DeviceStore } from './create-device-store.ts';
import type { EventLog } from './create-event-log.ts';
import type { GitService } from './create-git-service.ts';
import type { PushStore } from './create-push-store.ts';
import type { SessionRecord, SessionStore } from './create-session-store.ts';
import type { SessionSupervisor } from './create-session-supervisor.ts';

// Everything an RPC handler may touch (architecture.md § Daemon). Handlers get this and nothing
// else, so what the wire can reach is visible in one place.
export interface HandlerContext {
  daemonName: string;
  reposDir: string;
  worktreesDir: string;
  log: EventLog;
  sessions: SessionStore;
  devices: DeviceStore;
  comments: CommentStore;
  push: PushStore;
  asks: AskRegistry;
  git: GitService;
  supervisor: (record: SessionRecord) => SessionSupervisor;
  closeSupervisor: (session: string) => Promise<void>;
}

// A types-only module still needs a runtime export named as the file for the module shape rule
// and for the coverage table; this is that export.
export const handlerContext = { version: 1 } as const;
