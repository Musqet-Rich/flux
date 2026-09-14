import type { EventPayloads } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';

import type { LogFold } from './log-fold.ts';

// The question the agent is currently waiting on, if any: the latest `ask` with no
// `ask.answered` for its id (protocol.md § 5). A `session.cleared` marker is a boundary: the
// agent that asked is gone, so nothing before it can still be waiting. This takes the log in
// order, an answer after its ask (the box logs the ask before it can be answered), so an answer
// to the open one closes it and any other answer is to an ask a later one has already displaced.

export const openAsk: LogFold<EventPayloads['ask'] | null> = {
  init: () => null,
  step: (open, event) => {
    if (!fluxEvent.isKnown(event)) return open;
    if (event.type === 'ask') return event.payload;
    if (event.type === 'session.cleared') return null;
    if (event.type === 'ask.answered' && open?.askId === event.payload.askId) return null;
    return open;
  },
};
