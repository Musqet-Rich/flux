import type { FluxEvent } from '@flux/protocol';
import { fluxEvent, guards } from '@flux/protocol';

import type { SessionLog } from '../client/create-session-log.ts';
import type { StoreInternals } from './store-state.ts';

// The device's copy of each opened session's log (architecture.md § PWA): mirrored into the
// reactive view on every change and written to storage so the next boot renders before it
// syncs. The log itself is a plain closure (create-session-log.ts), so it is copied out rather
// than proxied.

const key = (session: string): string => `log:${session}`;

const publish = (i: StoreInternals, log: SessionLog): void => {
  const events = [...log.events()];
  const view = i.state.logs[log.session];
  if (view === undefined) {
    i.state.logs[log.session] = { events, streaming: log.streaming(), lastSeq: log.lastSeq() };
  } else {
    view.events = events;
    view.streaming = log.streaming();
    view.lastSeq = log.lastSeq();
  }
  void i.options.storage.set(key(log.session), events).catch(() => {
    // A failed cache write costs a re-sync next boot, nothing more.
  });
};

// Whatever is cached is validated on the way out; a corrupt cache is an empty one.
const load = async (i: StoreInternals, session: string): Promise<FluxEvent[]> => {
  const cached = await i.options.storage.get(key(session)).catch(() => null);
  return guards.isArrayOf(cached, fluxEvent.is) ? cached : [];
};

export const logCache: { key: typeof key; publish: typeof publish; load: typeof load } = {
  key,
  publish,
  load,
};
