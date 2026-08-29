import type { Ephemeral } from './ephemeral.ts';
import { ephemeral } from './ephemeral.ts';
import type { FluxEvent } from './flux-event.ts';
import { fluxEvent } from './flux-event.ts';
import { guards } from './guards.ts';

// Decrypted payloads are UTF-8 JSON in one of these shapes (protocol.md § 4).

export interface RpcError {
  code: string;
  message: string;
  data?: unknown;
}

export type Wire =
  | { kind: 'event'; event: FluxEvent }
  | { kind: 'ephemeral'; data: Ephemeral }
  | { kind: 'rpc'; id: string; method: string; params: unknown }
  | { kind: 'rpc.result'; id: string; ok: true; result: unknown }
  | { kind: 'rpc.result'; id: string; ok: false; error: RpcError };

const { isString, isRecord } = guards;

const isRpcError = (v: unknown): v is RpcError =>
  isRecord(v) && isString(v['code']) && isString(v['message']);

const is = (v: unknown): v is Wire => {
  if (!isRecord(v)) return false;
  switch (v['kind']) {
    case 'event':
      return fluxEvent.is(v['event']);
    case 'ephemeral':
      return ephemeral.is(v['data']);
    case 'rpc':
      return isString(v['id']) && isString(v['method']) && 'params' in v;
    case 'rpc.result':
      return (
        isString(v['id']) &&
        ((v['ok'] === true && 'result' in v) || (v['ok'] === false && isRpcError(v['error'])))
      );
    default:
      return false;
  }
};

export const wire: { is: typeof is; isRpcError: typeof isRpcError } = { is, isRpcError };
