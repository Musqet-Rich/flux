import type { FluxEvent } from '@flux/protocol';

import { createSession } from './create-session.ts';
import { emittingLog } from './emitting-log.ts';
import type { HandlerContext } from './handler-context.ts';
import type { ManagerControlOptions } from './manager-control.ts';
import { sessionLifecycle } from './session-lifecycle.ts';

// The three lifecycle ops the manager control handler needs (ADR 0025), built from the same
// HandlerContext the RPC handlers use so nothing is duplicated. `getCtx` defers the lookup because
// the control socket is wired before `ctx` exists in the composition root; the context is wrapped
// with an emitting log so a session the manager opens (or closes) reaches devices exactly as a
// device-driven one does (the plain `ctx.log` appends without broadcasting).
type ManagerOps = Pick<ManagerControlOptions, 'openSession' | 'archiveSession' | 'getAgents'>;

export const createManagerOps = (
  getCtx: () => HandlerContext,
  emit: (event: FluxEvent) => void,
): ManagerOps => {
  const managed = (): HandlerContext => {
    const ctx = getCtx();
    return { ...ctx, log: emittingLog(ctx.log, emit) };
  };
  return {
    openSession: (params) => createSession(managed(), params),
    archiveSession: async (session) => {
      await sessionLifecycle.archive(managed(), { session });
    },
    getAgents: () => getCtx().settings.getAgents(),
  };
};
