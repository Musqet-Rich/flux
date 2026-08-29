import type { FluxEvent } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';

import type { EventLog } from './create-event-log.ts';
import type { SessionStore } from './create-session-store.ts';

// What a daemon does on start with what the last one left behind (ADR 0017). An `ask` that
// never got its `ask.answered` has nobody waiting for the answer any more (the registry was in
// the dead process), so it is answered `aborted` and the card closes instead of erroring on
// tap. A session left `running` or `waiting_user` has no agent running: it is idle, and the
// next message resumes it. Only sessions in those two states can hold either kind of orphan,
// so only their logs are read.

export interface SettleOrphansOptions {
  log: EventLog;
  sessions: SessionStore;
}

export interface Settled {
  asks: number;
  sessions: number;
}

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

export const settleOrphans = ({ log, sessions }: SettleOrphansOptions): Settled => {
  const settled: Settled = { asks: 0, sessions: 0 };
  for (const summary of sessions.list()) {
    if (summary.state !== 'running' && summary.state !== 'waiting_user') continue;
    const { session } = summary;
    for (const askId of openAsks(readAll(log, session))) {
      log.append(session, { type: 'ask.answered', payload: { askId, answer: '', by: 'aborted' } });
      settled.asks += 1;
    }
    sessions.setState(session, 'idle');
    log.append(session, {
      type: 'session.state',
      payload: { state: 'idle', reason: 'daemon restarted' },
    });
    settled.sessions += 1;
  }
  return settled;
};
