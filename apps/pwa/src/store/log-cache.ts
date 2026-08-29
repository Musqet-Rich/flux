import type { FluxEvent } from '@flux/protocol';
import { fluxEvent, guards } from '@flux/protocol';

import type { SessionLog } from '../client/create-session-log.ts';
import type { StoreInternals } from './store-state.ts';

// The device's copy of each opened session's log (architecture.md § PWA). The log itself is a
// plain closure (create-session-log.ts) that only ever grows, so publishing appends the new
// tail to the reactive view and storage holds the log in fixed-size chunks, `log:<session>:<n>`,
// of which only the chunks the tail touches are rewritten.

const chunkSize = 256;

const key = (session: string, chunk: number): string => `log:${session}:${chunk}`;

const writeChunks = (i: StoreInternals, log: SessionLog, from: number): void => {
  const events = log.events();
  const first = Math.floor(from / chunkSize);
  const last = Math.floor((events.length - 1) / chunkSize);
  for (let chunk = first; chunk <= last; chunk += 1) {
    const slice = events.slice(chunk * chunkSize, (chunk + 1) * chunkSize);
    void i.options.storage.set(key(log.session, chunk), slice).catch(() => {
      // A failed cache write costs a re-sync next boot, nothing more.
    });
  }
};

const publish = (i: StoreInternals, log: SessionLog): void => {
  const events = log.events();
  const view = i.state.logs[log.session];
  if (view === undefined) {
    i.state.logs[log.session] = {
      events: [...events],
      streaming: log.streaming(),
      lastSeq: log.lastSeq(),
      thinking: null,
      context: null,
      changes: 0,
    };
    if (events.length > 0) writeChunks(i, log, 0);
    return;
  }
  const from = view.events.length;
  if (events.length > from) {
    view.events.push(...events.slice(from));
    writeChunks(i, log, from);
  }
  view.streaming = log.streaming();
  view.lastSeq = log.lastSeq();
};

// Chunks are read in order until one is missing; whatever is cached is validated on the way
// out, and a corrupt chunk ends the log there so seq stays gapless.
const load = async (i: StoreInternals, session: string, chunk = 0): Promise<FluxEvent[]> => {
  const cached = await i.options.storage.get(key(session, chunk)).catch(() => null);
  if (!guards.isArrayOf(cached, fluxEvent.is) || cached.length === 0) return [];
  if (cached.length < chunkSize) return cached;
  return [...cached, ...(await load(i, session, chunk + 1))];
};

export const logCache: {
  key: typeof key;
  chunkSize: number;
  publish: typeof publish;
  load: typeof load;
} = { key, chunkSize, publish, load };
