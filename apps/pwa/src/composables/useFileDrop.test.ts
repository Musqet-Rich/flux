import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';
import { defineComponent, h, ref } from 'vue';

import { useFileDrop } from './useFileDrop.ts';

// A page with a bar and something else; drops carry files through a plain event with a
// `dataTransfer` shaped like the browser's, since happy-dom has no DragEvent.

const file = new File(['x'], 'a.txt', { type: 'text/plain' });

const dragEvent = (type: string, files: File[] = [], types = ['Files']): Event => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files, types, dropEffect: '' } });
  return event;
};

const page = () => {
  const dropped: File[][] = [];
  const Host = defineComponent({
    setup() {
      const bar = ref<HTMLElement | null>(null);
      const drop = useFileDrop(
        () => [bar.value],
        (files) => {
          dropped.push(files);
        },
      );
      return () =>
        h('div', [
          h('div', { class: 'elsewhere' }, 'page'),
          h('div', { class: 'bar', ref: bar }, drop.over.value ? 'over' : 'idle'),
        ]);
    },
  });
  const wrapper = mount(Host, { attachTo: document.body });
  return { wrapper, dropped };
};

test('a drop on the bar hands over its files; elsewhere it is swallowed', async () => {
  const { wrapper, dropped } = page();
  const bar = wrapper.find('.bar').element;
  const elsewhere = wrapper.find('.elsewhere').element;
  const over = dragEvent('dragover');
  bar.dispatchEvent(over);
  expect(over.defaultPrevented).toBe(true);
  await wrapper.vm.$nextTick();
  expect(wrapper.find('.bar').text()).toBe('over');
  expect(bar.classList.contains('drop-target')).toBe(true);
  const away = dragEvent('dragover');
  elsewhere.dispatchEvent(away);
  expect(away.defaultPrevented).toBe(true);
  await wrapper.vm.$nextTick();
  expect(wrapper.find('.bar').text()).toBe('idle');
  expect(bar.classList.contains('drop-target')).toBe(false);
  const stray = dragEvent('drop', [file]);
  elsewhere.dispatchEvent(stray);
  expect(stray.defaultPrevented).toBe(true);
  expect(dropped).toEqual([]);
  const onBar = dragEvent('drop', [file]);
  bar.dispatchEvent(onBar);
  expect(onBar.defaultPrevented).toBe(true);
  expect(dropped).toEqual([[file]]);
  bar.dispatchEvent(dragEvent('drop', []));
  expect(dropped).toHaveLength(1);
  wrapper.unmount();
  bar.dispatchEvent(dragEvent('drop', [file]));
  expect(dropped).toHaveLength(1);
});

// A selection dragged within the editor carries text, not files: the page leaves it alone,
// so CodeMirror's own drag and drop keeps working.
test('a drag without files is not touched', async () => {
  const { wrapper, dropped } = page();
  const bar = wrapper.find('.bar').element;
  const over = dragEvent('dragover', [], ['text/plain']);
  bar.dispatchEvent(over);
  expect(over.defaultPrevented).toBe(false);
  await wrapper.vm.$nextTick();
  expect(wrapper.find('.bar').text()).toBe('idle');
  expect(bar.classList.contains('drop-target')).toBe(false);
  const drop = dragEvent('drop', [file], ['text/plain']);
  bar.dispatchEvent(drop);
  expect(drop.defaultPrevented).toBe(false);
  expect(dropped).toEqual([]);
  wrapper.unmount();
});

test('filesOf reads a paste or a drop and ignores anything else', () => {
  const { wrapper } = page();
  const drop = useFileDrop(
    () => [],
    () => {},
  );
  const paste = new Event('paste');
  Object.defineProperty(paste, 'clipboardData', { value: { files: [file, 'not a file'] } });
  expect(drop.filesOf(paste)).toEqual([file]);
  expect(drop.filesOf(dragEvent('drop', [file]))).toEqual([file]);
  expect(drop.filesOf(new Event('keydown'))).toEqual([]);
  const empty = new Event('paste');
  Object.defineProperty(empty, 'clipboardData', { value: { files: null } });
  expect(drop.filesOf(empty)).toEqual([]);
  wrapper.unmount();
});
