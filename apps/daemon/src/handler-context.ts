import type { EnvSettings, HarnessKind } from '@flux/protocol';

import type { SessionRecord } from './create-session-store.ts';
import type { SessionSupervisor } from './create-session-supervisor.ts';
import type { Services } from './open-services.ts';

// What the `daemon.update` handler needs (ADR 0022): the running version and the shared semver
// decide whether a target is installable; `distDir` is null on a dev build (run from source),
// which is refused; `apply` fires the async fetch→verify→swap→exit and returns at once.
export interface UpdateService {
  currentVersion: string;
  distDir: string | null;
  apply: (target: string) => void;
}

// Everything an RPC handler may touch (architecture.md § Daemon). Handlers get this and nothing
// else, so what the wire can reach is visible in one place. The service types are named through
// `Services` rather than imported one by one to stay inside the per-file import budget.
export interface HandlerContext {
  daemonName: string;
  // base64url of the raw P-256 VAPID public key; the PWA subscribes with it (ADR 0013).
  vapidPublicKey: string;
  // What only the environment sets; reported read-only by `settings.get`.
  env: EnvSettings;
  // Harnesses whose binary was found at start (detect-agents.ts); the rest are `agent_unavailable`.
  agents: HarnessKind[];
  worktreesDir: string;
  log: Services['log'];
  sessions: Services['sessions'];
  devices: Services['devices'];
  comments: Services['comments'];
  attachments: Services['attachments'];
  push: Services['push'];
  settings: Services['settings'];
  harnessConfig: Services['harnessConfig'];
  asks: Services['asks'];
  git: Services['git'];
  supervisor: (record: SessionRecord) => SessionSupervisor;
  closeSupervisor: (session: string) => Promise<void>;
  // Drops the agent's own state for an archived session (create-agent-commands.ts).
  forgetAgentSession: (session: string) => void;
  // Forgets a device everywhere: trust list, push subscriptions, live channels.
  revokeDevice: (deviceId: string) => Promise<void>;
  // Self-update (ADR 0022): validates a `daemon.update` target and kicks off the install.
  update: UpdateService;
}

// A types-only module still needs a runtime export named as the file for the module shape rule
// and for the coverage table; this is that export.
export const handlerContext = { version: 1 } as const;
