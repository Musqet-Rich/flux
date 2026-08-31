import type { FluxEvent } from '@flux/protocol';

import { createAttachmentHandlers } from './create-attachment-handlers.ts';
import { createRepoHandlers } from './create-repo-handlers.ts';
import { createSessionHandlers } from './create-session-handlers.ts';
import { createSettingsHandlers } from './create-settings-handlers.ts';
import { createShellHandlers } from './create-shell-handlers.ts';
import { createSkillsHandlers } from './create-skills-handlers.ts';
import { createUpdateHandlers } from './create-update-handlers.ts';
import { emittingLog } from './emitting-log.ts';
import type { HandlerContext, RpcHandlers } from './handler-context.ts';

// All RPC methods of protocol.md § 7, in four groups that fit the file size rules. What a
// handler appends (session.created, comment.added, comment.sent, ...) reaches devices through
// `emit` the way a supervisor's events do; the supervisors emit for themselves and keep the
// plain log.
export const createRpcHandlers = (
  ctx: HandlerContext,
  emit: (event: FluxEvent) => void,
): RpcHandlers => {
  const shared = { ...ctx, log: emittingLog(ctx.log, emit) };
  return {
    ...createSessionHandlers(shared),
    ...createRepoHandlers(shared),
    ...createSettingsHandlers(shared),
    ...createSkillsHandlers(shared),
    ...createAttachmentHandlers(shared),
    ...createUpdateHandlers(shared),
    ...createShellHandlers(shared),
  };
};
