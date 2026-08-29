import type { FluxEvent } from '@flux/protocol';

import { createRepoHandlers } from './create-repo-handlers.ts';
import type { RpcHandlers } from './create-rpc-router.ts';
import { createSessionHandlers } from './create-session-handlers.ts';
import { emittingLog } from './emitting-log.ts';
import type { HandlerContext } from './handler-context.ts';

// All RPC methods of protocol.md § 7, in two groups that fit the file size rules. What a
// handler appends (session.created, comment.added, comment.sent, ...) reaches devices through
// `emit` the way a supervisor's events do; the supervisors emit for themselves and keep the
// plain log.
export const createRpcHandlers = (
  ctx: HandlerContext,
  emit: (event: FluxEvent) => void,
): RpcHandlers => {
  const shared = { ...ctx, log: emittingLog(ctx.log, emit) };
  return { ...createSessionHandlers(shared), ...createRepoHandlers(shared) };
};
