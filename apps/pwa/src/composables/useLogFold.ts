import type { FluxEvent } from '@flux/protocol';
import type { ComputedRef } from 'vue';
import { computed, toRaw } from 'vue';

import type { LogFold } from '../store/log-fold.ts';

// A fold (store/log-fold) kept up with a reactive log. The computed remembers how many events
// it has stepped over and, when the log grows, steps over the new ones only; a log that is a
// different array, or that no longer has the last event stepped where it was (shorter, or cut
// and refilled between reads), starts the fold over. The events are read off the raw array so
// the computed depends on the log's length alone, not on a hundred thousand indices.

export const useLogFold = <T>(
  events: () => readonly FluxEvent[],
  fold: LogFold<T>,
): ComputedRef<T> => {
  let source: readonly FluxEvent[] | null = null;
  let seen = 0;
  let last: FluxEvent | undefined;
  let acc = fold.init();
  return computed(() => {
    const list = events();
    const { length } = list;
    const raw = toRaw(list);
    if (list !== source || length < seen || (seen > 0 && raw[seen - 1] !== last)) {
      source = list;
      seen = 0;
      acc = fold.init();
    }
    for (; seen < length; seen += 1) {
      last = raw[seen];
      if (last !== undefined) acc = fold.step(acc, last);
    }
    return acc;
  });
};
