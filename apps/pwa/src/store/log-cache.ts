import type { FluxEvent } from '@flux/protocol';
import { fluxEvent, guards } from '@flux/protocol';
import { shallowReactive } from 'vue';

import type { SessionLog } from '../client/create-session-log.ts';
import type { StoreInternals } from './store-state.ts';

// The device's copy of each opened session's log (architecture.md § PWA). The log itself is a
// plain closure (create-session-log.ts) that only ever grows, so publishing appends the new
// tail to the reactive view and storage holds the log in fixed-size chunks, `log:<session>:<n>`,
// of which only the chunks the tail touches are rewritten.
//
// The view's array is shallow: the screen wants to know when the log grows, never when an
// event changes, since none ever does, and a day's session holds a hundred thousand events
// with tool output under them that a deep proxy would wrap one property at a time. The chunk
// writes wait `writeDelayMs` after the first publish they cover, so a burst of events costs one
// write of the chunks it touched per delay, not a copy of a chunk per event; a stopped store
// writes what is waiting, and a write that never comes (the tab closed in the gap) costs a
// re-sync of that tail next boot, nothing more.

const chunkSize = 256;
const writeDelayMs = 500;
const pushSize = 1024;

const key = (session: string, chunk: number): string => `log:${session}:${chunk}`;

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const timer = setTimeout(fn, ms);
  return () => {
    clearTimeout(timer);
  };
};

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

// Queues a write of the log from `from`; one already waiting takes the earlier start and
// keeps its time, so a log that never pauses still writes once a delay.
const queueWrite = (i: StoreInternals, log: SessionLog, from: number): void => {
  const waiting = i.cacheWrites.get(log.session);
  if (waiting !== undefined) {
    waiting.from = Math.min(waiting.from, from);
    return;
  }
  const schedule = i.options.schedule ?? defaultSchedule;
  const entry = {
    from,
    cancel: schedule(() => {
      i.cacheWrites.delete(log.session);
      writeChunks(i, log, entry.from);
    }, writeDelayMs),
  };
  i.cacheWrites.set(log.session, entry);
};

// Drops the writes still waiting, for a store that is forgetting its box.
const cancelWrites = (i: StoreInternals): void => {
  for (const waiting of i.cacheWrites.values()) waiting.cancel();
  i.cacheWrites.clear();
};

// Writes what is waiting now, for a store that is stopping.
const flushWrites = (i: StoreInternals): void => {
  for (const [session, waiting] of i.cacheWrites) {
    waiting.cancel();
    const log = i.logs.get(session);
    if (log !== undefined) writeChunks(i, log, waiting.from);
  }
  i.cacheWrites.clear();
};

const publish = (i: StoreInternals, log: SessionLog): void => {
  const events = log.events();
  const view = i.state.logs[log.session];
  // A view is made once, from the cache's own events (session-logs.ts), so nothing to write.
  if (view === undefined) {
    i.state.logs[log.session] = {
      events: shallowReactive([...events]),
      streaming: log.streaming(),
      lastSeq: log.lastSeq(),
      thinking: null,
      context: null,
      changes: 0,
    };
    return;
  }
  const from = view.events.length;
  if (events.length > from) {
    // In fixed-size pushes: a first sync of a long session lands a hundred thousand events at
    // once, more than one spread can pass, and each push is a change the screen's folds step
    // over, so not one at a time either.
    for (let n = from; n < events.length; n += pushSize) {
      view.events.push(...events.slice(n, n + pushSize));
    }
    queueWrite(i, log, from);
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
  cancelWrites: typeof cancelWrites;
  flushWrites: typeof flushWrites;
  load: typeof load;
} = { key, chunkSize, publish, cancelWrites, flushWrites, load };
