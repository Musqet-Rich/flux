import type { EventPayloads, FluxEvent } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';

// The question the agent is currently waiting on, if any: the latest `ask` with no
// `ask.answered` for its id (protocol.md § 5). A `session.cleared` marker is a boundary: the
// agent that asked is gone, so nothing before it can still be waiting.

export const openAsk = (events: readonly FluxEvent[]): EventPayloads['ask'] | null => {
  const answered = new Set<string>();
  let open: EventPayloads['ask'] | null = null;
  for (const event of events) {
    if (!fluxEvent.isKnown(event)) continue;
    if (event.type === 'ask.answered') answered.add(event.payload.askId);
    else if (event.type === 'ask') open = event.payload;
    else if (event.type === 'session.cleared') open = null;
  }
  return open !== null && !answered.has(open.askId) ? open : null;
};
