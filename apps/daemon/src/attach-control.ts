import { join } from 'node:path';

import type { ControlHandlerOptions } from './create-control-handler.ts';
import { createControlHandler } from './create-control-handler.ts';
import type { ControlSocket } from './create-control-socket.ts';
import { createControlSocket } from './create-control-socket.ts';

// Wires the control socket (ADR 0008) to its handler at `<dataDir>/control.sock`.

export interface AttachedControl extends ControlSocket {
  path: string;
}

export interface AttachControlOptions extends ControlHandlerOptions {
  dataDir: string;
}

export const attachControl = (options: AttachControlOptions): AttachedControl => {
  const { dataDir, ...handler } = options;
  const path = join(dataDir, 'control.sock');
  const socket = createControlSocket({ path, handle: createControlHandler(handler) });
  return { path, ...socket };
};
