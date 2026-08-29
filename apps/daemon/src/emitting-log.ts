import type { FluxEvent } from '@flux/protocol';

import type { EventLog } from './create-event-log.ts';

// An event log whose every append is also handed to `emit`, for writers that do not emit for
// themselves (the RPC handlers). Reads pass straight through.
export const emittingLog = (log: EventLog, emit: (event: FluxEvent) => void): EventLog => ({
  ...log,
  append: (session, input) => {
    const event = log.append(session, input);
    emit(event);
    return event;
  },
});
