import { guards } from './guards.ts';

// Never logged, may be dropped (protocol.md § 6).

export type Ephemeral =
  | { type: 'delta'; session: string; forSeq: number; text: string }
  | { type: 'typing'; session: string; deviceId: string }
  | { type: 'agent.status'; session: string; status: 'thinking' | 'tool' | 'idle' };

const { isString, isInteger, isRecord, isOneOf } = guards;

const is = (v: unknown): v is Ephemeral => {
  if (!isRecord(v) || !isString(v['session'])) return false;
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
