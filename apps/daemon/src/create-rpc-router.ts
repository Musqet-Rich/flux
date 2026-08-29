import type { RpcError, RpcMethod, RpcMethods, Wire } from '@flux/protocol';
import { rpcMethods } from '@flux/protocol';

import type { Peer } from './create-device-channels.ts';
import { DaemonError } from './daemon-error.ts';

// Dispatches `rpc` messages to handlers (protocol.md § 7): validates params with the protocol
// guards, gates everything but pair.request behind pairing, and turns thrown errors into
// RpcError results so a device always gets an answer.

export type RpcHandlers = {
  [M in RpcMethod]: (
    params: RpcMethods[M]['params'],
    peer: Peer,
  ) => Promise<RpcMethods[M]['result']>;
};

export type RpcRouter = (peer: Peer, message: Wire) => Promise<Wire | null>;

const isMethod = (name: string): name is RpcMethod => Object.hasOwn(rpcMethods, name);

const errorOf = (error: unknown): RpcError => {
  if (error instanceof DaemonError) return { code: error.code, message: error.message };
  return { code: 'internal', message: error instanceof Error ? error.message : 'unknown error' };
};

// Indexing the handler map and the params map with the same key keeps the two correlated, so
// each handler receives exactly its own params type without a cast.
const dispatch = <M extends RpcMethod>(
  handlers: RpcHandlers,
  method: M,
  params: RpcMethods[M]['params'],
  peer: Peer,
): Promise<RpcMethods[M]['result']> => handlers[method](params, peer);

const call = (
  handlers: RpcHandlers,
  method: RpcMethod,
  params: unknown,
  peer: Peer,
): Promise<unknown> => {
  const guard = rpcMethods[method];
  if (!guard(params)) throw new DaemonError('bad_params', `invalid params for ${method}`);
  return dispatch(handlers, method, params, peer);
};

export const createRpcRouter = (handlers: RpcHandlers): RpcRouter => {
  return async (peer, message) => {
    if (message.kind !== 'rpc') return null;
    const { id, method } = message;
    try {
      if (!isMethod(method)) throw new DaemonError('not_found', `unknown method ${method}`);
      if (peer.device === null && method !== 'pair.request') {
        throw new DaemonError('not_paired', 'pair this device first');
      }
      const result = await call(handlers, method, message.params, peer);
      return { kind: 'rpc.result', id, ok: true, result };
    } catch (error) {
      return { kind: 'rpc.result', id, ok: false, error: errorOf(error) };
    }
  };
};
