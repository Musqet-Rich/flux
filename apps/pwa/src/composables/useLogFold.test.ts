import type { FluxEvent } from '@flux/protocol';
import { expect, test } from 'vitest';
import { computed, reactive, shallowReactive, watch } from 'vue';

import type { LogFold } from '../store/log-fold.ts';
import { logFold } from '../store/log-fold.ts';
import { useLogFold } from './useLogFold.ts';

const ev = (seq: number, text = `m${seq}`): FluxEvent => ({
  seq,
  ts: 't',
  session: 's1',
  type: 'msg.user',
  payload: { text },
});

// Counts the steps taken, and sums the seqs seen.
const counting = (): { fold: LogFold<number>; steps: () => number } => {
  let steps = 0;
  return {
    fold: {
      init: () => 0,
      step: (acc, event) => {
        steps += 1;
        return acc + event.seq;
      },
    },
    steps: () => steps,
  };
};

test('steps over the new events only as the log grows', () => {
  const events = shallowReactive([ev(1), ev(2)]);
  const { fold, steps } = counting();
  const sum = useLogFold(() => events, fold);
  expect(sum.value).toBe(3);
  expect(steps()).toBe(2);
  events.push(ev(3));
  expect(sum.value).toBe(6);
  expect(steps()).toBe(3);
  expect(sum.value).toBe(6);
  expect(steps()).toBe(3);
});

test('starts over for a different log, or one that shrank', () => {
  const state = reactive<{ events: FluxEvent[] }>({ events: [ev(1), ev(2)] });
  const { fold, steps } = counting();
  const sum = useLogFold(() => state.events, fold);
  expect(sum.value).toBe(3);
  state.events = [ev(5)];
  expect(sum.value).toBe(5);
  expect(steps()).toBe(3);
  state.events.splice(0);
  expect(sum.value).toBe(0);
  // Cut and refilled past what was seen between reads: the last event stepped has moved.
  state.events.push(ev(1), ev(2));
  expect(sum.value).toBe(3);
  state.events.splice(0);
  state.events.push(ev(7), ev(8), ev(9));
  expect(sum.value).toBe(24);
});

// The texts of the messages with any, a message without one returning the value given.
const texts: LogFold<{ list: string[] }> = {
  init: () => ({ list: [] }),
  step: (acc, event) => {
    if (!logFold.isOf(event, 'msg.user') || event.payload.text === '') return acc;
    acc.list.push(event.payload.text);
    return { list: acc.list };
  },
};

// A step that returns what it was given tells the fold's readers nothing changed.
test('readers run when a step returns a new value, and not when it returns the old', () => {
  const events = shallowReactive([ev(1)]);
  const folded = useLogFold(() => events, texts);
  const seen = computed(() => folded.value.list.join(','));
  let runs = 0;
  watch(
    seen,
    () => {
      runs += 1;
    },
    { flush: 'sync' },
  );
  expect(seen.value).toBe('m1');
  events.push(ev(2, ''));
  expect(seen.value).toBe('m1');
  expect(runs).toBe(0);
  events.push(ev(3));
  expect(seen.value).toBe('m1,m3');
  expect(runs).toBe(1);
});
