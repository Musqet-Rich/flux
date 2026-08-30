import { guards } from './guards.ts';

// Never logged, may be dropped (protocol.md § 6). `device.revoked` is the one message without a
// session: the box sends it to a device it is about to stop talking to.

export type Ephemeral =
  | { type: 'delta'; session: string; forSeq: number; text: string }
  | { type: 'typing'; session: string; deviceId: string }
  | { type: 'agent.status'; session: string; status: 'thinking' | 'tool' | 'idle' }
  | { type: 'agent.thinking'; session: string; active: boolean; estimatedTokens?: number }
  | { type: 'agent.context'; session: string; tokens: number; model: string; window?: number }
  | { type: 'vcs.changed'; session: string; kind: string }
  | { type: 'device.revoked'; deviceId: string }
  // Self-update progress and failure (ADR 0022), session-less like `device.revoked`: the daemon
  // reports each phase as it fetches, verifies, installs and restarts, or the reason it aborted.
  // Success has no event; the daemon exits and the device reads the new `hello.version`.
  | { type: 'update.progress'; phase: UpdatePhase }
  | { type: 'update.failed'; reason: UpdateFailReason };

export type UpdatePhase = 'fetching' | 'verifying' | 'installing' | 'restarting';

export type UpdateFailReason =
  | 'bad_signature'
  | 'download_failed'
  | 'already_current'
  | 'unsupported'
  | 'disk_error';

const updatePhases: readonly UpdatePhase[] = ['fetching', 'verifying', 'installing', 'restarting'];
const updateFailReasons: readonly UpdateFailReason[] = [
  'bad_signature',
  'download_failed',
  'already_current',
  'unsupported',
  'disk_error',
];

const { isString, isInteger, isBoolean, isRecord, isOneOf, isOptional } = guards;

const is = (v: unknown): v is Ephemeral => {
  if (!isRecord(v)) return false;
  if (v['type'] === 'device.revoked') return isString(v['deviceId']);
  if (v['type'] === 'update.progress') return isOneOf(v['phase'], updatePhases);
  if (v['type'] === 'update.failed') return isOneOf(v['reason'], updateFailReasons);
  if (!isString(v['session'])) return false;
  switch (v['type']) {
    case 'delta':
      return isInteger(v['forSeq'], 1) && isString(v['text']);
    case 'typing':
      return isString(v['deviceId']);
    case 'agent.status':
      return isOneOf(v['status'], ['thinking', 'tool', 'idle']);
    case 'agent.thinking':
      return isBoolean(v['active']) && isOptional(v['estimatedTokens'], isInteger);
    case 'agent.context':
      return isInteger(v['tokens']) && isString(v['model']) && isOptional(v['window'], isInteger);
    case 'vcs.changed':
      return isString(v['kind']);
    default:
      return false;
  }
};

export const ephemeral: { is: typeof is } = { is };
