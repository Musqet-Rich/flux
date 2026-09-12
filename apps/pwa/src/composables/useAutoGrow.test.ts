import { mount } from '@vue/test-utils';
import type { MockInstance } from 'vitest';
import { expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';

import { useAutoGrow } from './useAutoGrow.ts';

// happy-dom has no layout: the box's metrics are inline styles and a `scrollHeight` pinned to
// a number the test moves, standing in for the text taking more or fewer lines.

const setup = () => {
  const text = ref('');
  let content = 30;
  const Box = defineComponent({
    setup: () => {
      const box = ref<HTMLTextAreaElement | null>(null);
      useAutoGrow(box, () => text.value, 10);
      return () =>
        h('div', [
          h('textarea', {
            ref: box,
            style: 'line-height: 20px; padding: 5px 0; border: 1px solid; font-size: 16px',
          }),
        ]);
    },
  });
  const wrapper = mount(Box, { attachTo: document.body });
  const el = wrapper.find('textarea').element;
  Object.defineProperty(el, 'scrollHeight', { get: () => content, configurable: true });
  const lines = async (n: number, value: string): Promise<void> => {
    content = n * 20 + 10;
    text.value = value;
    await nextTick();
  };
  return { el, lines, wrapper };
};

test('one line empty, a line per line of text, capped at ten with the rest scrolling', async () => {
  const { el, lines } = setup();
  // One line: the text's height plus the border.
  await lines(1, 'a');
  expect(el.style.height).toBe('32px');
  expect(el.style.overflowY).toBe('hidden');
  await lines(3, 'a\nb\nc');
  expect(el.style.height).toBe('72px');
  await lines(12, 'a\n'.repeat(12));
  expect(el.style.height).toBe('212px');
  expect(el.style.overflowY).toBe('auto');
  await lines(1, '');
  expect(el.style.height).toBe('32px');
  expect(el.style.overflowY).toBe('hidden');
  // The row around the box is held for the measure and let go after it; that it was held is
  // only visible with layout, so the e2e run and a WebKit probe cover it.
  expect(el.parentElement?.style.height).toBe('');
});

const resizeListeners = (spy: MockInstance<typeof window.addEventListener>): unknown[] =>
  spy.mock.calls.filter(([type]) => type === 'resize').map(([, listener]) => listener);

test('a window resize refits; unmounting takes the listener off', async () => {
  const added = vi.spyOn(window, 'addEventListener');
  const removed = vi.spyOn(window, 'removeEventListener');
  const { el, lines, wrapper } = setup();
  await lines(2, 'a\nb');
  expect(el.style.height).toBe('52px');
  Object.defineProperty(el, 'scrollHeight', { get: () => 70, configurable: true });
  window.dispatchEvent(new Event('resize'));
  expect(el.style.height).toBe('72px');
  expect(resizeListeners(added)).toHaveLength(1);
  expect(resizeListeners(removed)).toHaveLength(0);
  wrapper.unmount();
  expect(resizeListeners(removed)).toEqual(resizeListeners(added));
  added.mockRestore();
  removed.mockRestore();
});

test('a line-height of normal is taken as 1.2 of the font size', async () => {
  const { el, lines } = setup();
  el.style.lineHeight = 'normal';
  // Cap: 16 × 1.2 × 10 + 10 + 2 = 204.
  await lines(12, 'a\n'.repeat(12));
  expect(el.style.height).toBe('204px');
});
