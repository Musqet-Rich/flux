import type { FluxEvent } from '@flux/protocol';
import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';
import type { ShallowRef } from 'vue';
import { defineComponent, h, nextTick, reactive, ref, shallowRef } from 'vue';

import { useCommandHistory } from './useCommandHistory.ts';

// A textarea bound to a draft object the way v-model binds the composer's to the store's, over
// a log of user messages the test writes; each key is a keydown on the box and the answer is
// whether it was taken. `swap` puts another session's draft under the box, as a tab tap does.

const up = 'ArrowUp';
const down = 'ArrowDown';

const sent = (texts: string[]): FluxEvent[] =>
  texts.map((text, index) => ({
    session: 's1',
    seq: index + 1,
    ts: '2026-01-01T00:00:00Z',
    type: 'msg.user',
    payload: { text },
  }));
// The agent's prompt to a subagent: a `msg.user` too, under the task.
const delegated = (seq: number, text: string): FluxEvent => ({
  session: 's1',
  seq,
  ts: '2026-01-01T00:00:00Z',
  type: 'msg.user',
  payload: { text },
  parent: 'toolu_1',
});

// Ups back to back, each read by the composable before the box has rendered the last: the
// text it reads is the ref's, which is what the composer's v-model would hold.
const repeat = (el: HTMLTextAreaElement, times: number): void => {
  for (let step = 0; step < times; step += 1) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: up, cancelable: true }));
  }
};

interface Draft {
  text: string;
}

// The text of whichever draft is under the box, read and written as a ref would be.
const textOf = (current: ShallowRef<Draft>) => ({
  get value(): string {
    return current.value.text;
  },
  set value(next: string) {
    current.value.text = next;
  },
});

const setup = (events: FluxEvent[]) => {
  const current = shallowRef<Draft>(reactive({ text: '' }));
  const text = textOf(current);
  const log = ref(events);
  let history: ReturnType<typeof useCommandHistory> | null = null;
  const Box = defineComponent({
    setup: () => {
      const box = ref<HTMLTextAreaElement | null>(null);
      history = useCommandHistory(
        () => log.value,
        () => current.value,
        box,
      );
      return () =>
        h('textarea', {
          ref: box,
          value: current.value.text,
          onKeydown: (event: KeyboardEvent) => {
            history?.key(event);
          },
        });
    },
  });
  const wrapper = mount(Box, { attachTo: document.body });
  const el = wrapper.find('textarea').element;
  const press = async (key: string, init: KeyboardEventInit = {}): Promise<boolean> => {
    const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init });
    el.dispatchEvent(event);
    await nextTick();
    await nextTick();
    return event.defaultPrevented;
  };
  // Typing: the value and the ref, as v-model would, with the caret where it lands.
  const type = async (value: string, caret = value.length): Promise<void> => {
    el.value = value;
    text.value = value;
    el.setSelectionRange(caret, caret);
    await nextTick();
  };
  const swap = async (draft: Draft): Promise<void> => {
    current.value = draft;
    await nextTick();
  };
  const done = (): void => history?.done();
  return { el, log, text, press, type, swap, done, wrapper };
};

test('Up walks back through the sent messages, Down forward, and past the newest is the draft', async () => {
  const { el, text, press, type, wrapper } = setup(sent(['one', 'two', 'three']));
  await type('half typed');
  expect(await press(up)).toBe(true);
  expect(text.value).toBe('three');
  expect([el.selectionStart, el.selectionEnd]).toEqual([5, 5]);
  await press(up);
  await press(up);
  expect(text.value).toBe('one');
  // The oldest: the key is taken, so the caret stays, and the text stays.
  expect(await press(up)).toBe(true);
  expect(text.value).toBe('one');
  await press(down);
  await press(down);
  expect(text.value).toBe('three');
  expect(await press(down)).toBe(true);
  expect(text.value).toBe('half typed');
  // Not browsing: Down is the caret's.
  expect(await press(down)).toBe(false);
  wrapper.unmount();
});

test('an edit to a recalled message ends the browsing, and the next Up starts from the newest', async () => {
  const { text, press, type, wrapper } = setup(sent(['one', 'two']));
  await press(up);
  await press(up);
  expect(text.value).toBe('one');
  await type('one more');
  expect(await press(down)).toBe(false);
  await press(up);
  expect(text.value).toBe('two');
  await press(down);
  expect(text.value).toBe('one more');
  wrapper.unmount();
});

test('leaving while browsing puts the draft back; after a send or an edit it leaves the box be', async () => {
  const browsing = setup(sent(['one']));
  await browsing.type('half typed');
  await browsing.press(up);
  expect(browsing.text.value).toBe('one');
  browsing.wrapper.unmount();
  expect(browsing.text.value).toBe('half typed');
  // A send the box refused leaves the entry as the draft, like any message that did not go.
  const sentOff = setup(sent(['one']));
  await sentOff.type('half typed');
  await sentOff.press(up);
  sentOff.done();
  sentOff.wrapper.unmount();
  expect(sentOff.text.value).toBe('one');
  const edited = setup(sent(['one']));
  await edited.press(up);
  await edited.type('one more');
  edited.wrapper.unmount();
  expect(edited.text.value).toBe('one more');
});

test("another session's draft under the box puts the first back, and its own browse is its own", async () => {
  const { text, press, type, swap, wrapper } = setup(sent(['one', 'two']));
  const first = reactive({ text: '' });
  const second = reactive({ text: 'other draft' });
  await swap(first);
  await type('half typed');
  await press(up);
  expect(first.text).toBe('two');
  await swap(second);
  expect(first.text).toBe('half typed');
  expect(second.text).toBe('other draft');
  await press(up);
  expect(second.text).toBe('two');
  await press(up);
  expect(second.text).toBe('one');
  await swap(first);
  expect(second.text).toBe('other draft');
  expect(text.value).toBe('half typed');
  wrapper.unmount();
});

test('only from the edge of the text, and only a bare arrow', async () => {
  const { el, text, press, type, wrapper } = setup(sent(['two\nlines', 'one']));
  await type('a\nb', 3);
  expect(await press(up)).toBe(false);
  await type('a\nb', 0);
  expect(await press(up)).toBe(true);
  expect(text.value).toBe('one');
  // A single line is both edges: Down from its start is the history's too.
  await type('one', 0);
  expect(await press(down)).toBe(true);
  expect(text.value).toBe('a\nb');
  expect(await press(up, { shiftKey: true })).toBe(false);
  expect(await press(up, { metaKey: true })).toBe(false);
  expect(await press(up, { isComposing: true })).toBe(false);
  expect(text.value).toBe('a\nb');
  // A recalled entry of two lines lands with the caret at its end, on the last line, so the
  // next Up moves the caret to the first line, and only the Up after that goes on back; from
  // the first line a Down is the caret's as well.
  await type('a\nb', 0);
  await press(up);
  await press(up);
  expect(text.value).toBe('two\nlines');
  expect([el.selectionStart, el.selectionEnd]).toEqual([9, 9]);
  expect(await press(up)).toBe(false);
  await type('two\nlines', 0);
  expect(await press(down)).toBe(false);
  expect(await press(up)).toBe(true);
  expect(text.value).toBe('two\nlines');
  wrapper.unmount();
});

test('an empty log leaves the arrows alone; a repeat counts once; a hundred are kept', async () => {
  const { el, text, log, press, wrapper } = setup([]);
  expect(await press(up)).toBe(false);
  log.value = [...sent(['same', 'same', 'other', 'same']), delegated(5, 'from the agent')];
  await press(up);
  expect(text.value).toBe('same');
  await press(up);
  await press(up);
  expect(text.value).toBe('same');
  expect(await press(up)).toBe(true);
  expect(text.value).toBe('same');
  log.value = sent(Array.from({ length: 120 }, (_, index) => `m${index + 1}`));
  // Browsing ends with the text differing from what was shown; from the newest, 99 more back.
  text.value = '';
  repeat(el, 100);
  await nextTick();
  expect(text.value).toBe('m21');
  await press(up);
  expect(text.value).toBe('m21');
  // Repeats are dropped before the cap: fifty messages sent twice each after a first are 101
  // rows, and the first is still there, which a cap over the rows would have cut.
  log.value = sent(['first', ...Array.from({ length: 100 }, (_, index) => `r${index >> 1}`)]);
  text.value = '';
  repeat(el, 51);
  await nextTick();
  expect(text.value).toBe('first');
  wrapper.unmount();
});
