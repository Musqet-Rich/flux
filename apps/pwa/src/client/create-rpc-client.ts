import type { RpcMethods, Wire } from '@flux/protocol';
import { rpcResults } from '@flux/protocol';

import { ClientError } from './client-error.ts';

// Correlates `rpc` requests with their `rpc.result` (protocol.md § 4) and checks each result
// against its guard. The transport is whatever `send` does; this only owns the pending map.

export type RpcCall = <M extends keyof RpcMethods>(
  method: M,
  params: RpcMethods[M]['params'],
) => Promise<RpcMethods[M]['result']>;

export interface RpcClient {
  call: RpcCall;
  // Feeds a decoded wire message; returns true if it was a result this client was waiting for.
  receive: (message: Wire) => boolean;
  // Rejects everything in flight, e.g. when the socket drops.
  rejectAll: (error: ClientError) => void;
  pending: () => number;
}

export interface RpcClientOptions {
  send: (message: Wire) => void;
  timeoutMs?: number;
}

interface Pending {
  settle: (result: unknown) => void;
  reject: (error: ClientError) => void;
  timer: ReturnType<typeof setTimeout>;
}

const defaultTimeoutMs = 30_000;

export const createRpcClient = (options: RpcClientOptions): RpcClient => {
  const pending = new Map<string, Pending>();
  const settle = (id: string): Pending | undefined => {
    const entry = pending.get(id);
    if (entry !== undefined) {
      clearTimeout(entry.timer);
      pending.delete(id);
    }
    return entry;
  };
  const call: RpcCall = (method, params) =>
    new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        settle(id)?.reject(new ClientError('timeout', `${method} timed out`));
      }, options.timeoutMs ?? defaultTimeoutMs);
      const guard = rpcResults[method];
      const settleWith = (result: unknown): void => {
        if (guard(result)) resolve(result);
        else reject(new ClientError('bad_reply', `${method}: malformed result`));
      };
      pending.set(id, { settle: settleWith, reject, timer });
      options.send({ kind: 'rpc', id, method, params });
    });
  return {
    call,
    receive: (message) => {
      if (message.kind !== 'rpc.result') return false;
      const entry = settle(message.id);
      if (entry === undefined) return false;
      if (message.ok) entry.settle(message.result);
      else entry.reject(new ClientError(message.error.code, message.error.message));
      return true;
    },
    rejectAll: (error) => {
      for (const [id] of pending) settle(id)?.reject(error);
    },
    pending: () => pending.size,
  };
};
