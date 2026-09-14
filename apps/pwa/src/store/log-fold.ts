import type { Envelope, EventPayloads, EventType, FluxEvent } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';

// What a screen derives from a session's log, written as a fold so it can be kept up as the
// log grows instead of re-read from the top (architecture.md § PWA). A log only ever appends,
// so a derivation that has seen the first n events needs only the events after them: `step`
// takes the value so far and one more event and returns the value after it, and
// useLogFold (composables/) does exactly that from a reactive log, a day's session of a
// hundred thousand events costing each incoming event one step per fold, not one pass.
//
// The value returned is what the screen reads, so a step that changes nothing returns the
// value it was given, and a step that changes something returns a new one: a scalar, or a
// fresh wrapper around the same collection, since a Vue computed only tells its readers when
// its value's identity changed. `logFold.run` runs a fold over a whole log for the callers
// that have the events in hand rather than a reactive view of them.

export interface LogFold<T> {
  init: () => T;
  step: (acc: T, event: FluxEvent) => T;
}

const run = <T>(events: readonly FluxEvent[], fold: LogFold<T>): T => {
  let acc = fold.init();
  for (const event of events) acc = fold.step(acc, event);
  return acc;
};

// Narrows an event to one known type, so its payload can be read.
const isOf = <T extends EventType>(event: FluxEvent, type: T): event is Envelope<T> =>
  event.type === type && fluxEvent.isKnown(event);

// The latest event of a type, by payload: null until one has been logged.
const latest = <T extends EventType>(type: T): LogFold<EventPayloads[T] | null> => ({
  init: () => null,
  step: (acc, event) => (isOf(event, type) ? event.payload : acc),
});

export const logFold: { run: typeof run; isOf: typeof isOf; latest: typeof latest } = {
  run,
  isOf,
  latest,
};
