import type { FluxEvent } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';

import type { EventLog } from './create-event-log.ts';

// Every `ask` of one session still open in its log (no `ask.answered` for its id) is answered
// `aborted`; returns how many were. Used on start for the sessions the last daemon left
// waiting (settle-orphans.ts, ADR 0017) and when an agent is closed on purpose (session-
// lifecycle.ts, ADR 0018). With `abort`, an ask the registry still holds is settled there and
// its control handler logs the answer; only an ask nobody is waiting on is logged here.

const readAll = (log: EventLog, session: string): FluxEvent[] => {
  const events: FluxEvent[] = [];
  let since = 0;
  for (;;) {
    const page = log.read(session, since);
    events.push(...page.events);
    const last = page.events.at(-1);
    if (page.complete || last === undefined) return events;
    since = last.seq;
  }
};

const openAsks = (events: FluxEvent[]): string[] => {
  const open = new Set<string>();
  for (const event of events) {
    if (!fluxEvent.isKnown(event)) continue;
    if (event.type === 'ask') open.add(event.payload.askId);
    else if (event.type === 'ask.answered') open.delete(event.payload.askId);
  }
  return [...open];
};

export const settleAsks = (
  log: EventLog,
  session: string,
  abort: (askId: string) => boolean = () => false,
): number => {
  const open = openAsks(readAll(log, session));
  for (const askId of open) {
    if (abort(askId)) continue;
    log.append(session, { type: 'ask.answered', payload: { askId, answer: '', by: 'aborted' } });
  }
  return open.length;
};
