import { join } from 'node:path';

import type { ControlHandlerOptions } from './create-control-handler.ts';
import { createControlHandler } from './create-control-handler.ts';
import type { ControlSocket } from './create-control-socket.ts';
import { createControlSocket } from './create-control-socket.ts';
import { createManagerOps } from './create-manager-ops.ts';
import type { HandlerContext } from './handler-context.ts';

// Wires the control socket (ADR 0008) to its handler at `<dataDir>/control.sock`. The manager ops
// (ADR 0025) are built here from a lazy `ctx` getter, so the composition root can wire the socket
// before the handler context exists (create-daemon.ts).

export interface AttachedControl extends ControlSocket {
  path: string;
}

export interface AttachControlOptions extends Omit<
  ControlHandlerOptions,
  'openSession' | 'archiveSession' | 'getAgents'
> {
  dataDir: string;
  ctx: () => HandlerContext;
}

export const attachControl = (options: AttachControlOptions): AttachedControl => {
  const { dataDir, ctx, ...handler } = options;
  const path = join(dataDir, 'control.sock');
  const managerOps = createManagerOps(ctx, options.emit);
  const socket = createControlSocket({
    path,
    handle: createControlHandler({ ...handler, ...managerOps }),
  });
  return { path, ...socket };
};
