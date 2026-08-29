import { createRepoHandlers } from './create-repo-handlers.ts';
import type { RpcHandlers } from './create-rpc-router.ts';
import { createSessionHandlers } from './create-session-handlers.ts';
import type { HandlerContext } from './handler-context.ts';

// All RPC methods of protocol.md § 7, in two groups that fit the file size rules.
export const createRpcHandlers = (ctx: HandlerContext): RpcHandlers => ({
  ...createSessionHandlers(ctx),
  ...createRepoHandlers(ctx),
});
