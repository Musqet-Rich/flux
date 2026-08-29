import type { EventPayloads, FluxEvent } from '@flux/protocol';

// The question the agent is currently waiting on, if any: the latest `ask` with no
// `ask.answered` for its id (protocol.md § 5).

export const openAsk = (events: readonly FluxEvent[]): EventPayloads['ask'] | null => {
  const answered = new Set<string>();
  let open: EventPayloads['ask'] | null = null;
  for (const event of events) {
    if (event.type === 'ask.answered') answered.add(event.payload.askId);
    else if (event.type === 'ask') open = event.payload;
  }
  return open !== null && !answered.has(open.askId) ? open : null;
};
