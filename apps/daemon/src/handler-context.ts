import type { EnvSettings } from '@flux/protocol';

import type { SessionRecord } from './create-session-store.ts';
import type { SessionSupervisor } from './create-session-supervisor.ts';
import type { Services } from './open-services.ts';

// Everything an RPC handler may touch (architecture.md § Daemon): the services minus their
// shutdown, plus the process-level facts. Handlers get this and nothing else, so what the wire
// can reach is visible in one place.
export interface HandlerContext extends Omit<Services, 'close'> {
  daemonName: string;
  // base64url of the raw P-256 VAPID public key; the PWA subscribes with it (ADR 0013).
  vapidPublicKey: string;
  // What only the environment sets; reported read-only by `settings.get`.
  env: EnvSettings;
  supervisor: (record: SessionRecord) => SessionSupervisor;
  closeSupervisor: (session: string) => Promise<void>;
  // Forgets a device everywhere: trust list, push subscriptions, live channels.
  revokeDevice: (deviceId: string) => Promise<void>;
}

// A types-only module still needs a runtime export named as the file for the module shape rule
// and for the coverage table; this is that export.
export const handlerContext = { version: 1 } as const;
