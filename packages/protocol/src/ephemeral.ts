import { guards } from './guards.ts';

// Never logged, may be dropped (protocol.md § 6). `device.revoked` is the one message without a
// session: the box sends it to a device it is about to stop talking to.

export type Ephemeral =
  | { type: 'delta'; session: string; forSeq: number; text: string }
  | { type: 'typing'; session: string; deviceId: string }
  | { type: 'agent.status'; session: string; status: 'thinking' | 'tool' | 'idle' }
  | { type: 'device.revoked'; deviceId: string };

const { isString, isInteger, isRecord, isOneOf } = guards;

const is = (v: unknown): v is Ephemeral => {
  if (!isRecord(v)) return false;
  if (v['type'] === 'device.revoked') return isString(v['deviceId']);
  if (!isString(v['session'])) return false;
  switch (v['type']) {
    case 'delta':
      return isInteger(v['forSeq'], 1) && isString(v['text']);
    case 'typing':
      return isString(v['deviceId']);
    case 'agent.status':
      return isOneOf(v['status'], ['thinking', 'tool', 'idle']);
    default:
      return false;
  }
};

export const ephemeral: { is: typeof is } = { is };
