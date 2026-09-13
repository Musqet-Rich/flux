import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';

import { useFocusChord } from './useFocusChord.ts';

// The chord puts the caret at the end of the box while the owner is mounted, takes the key
// only then, and leaves a disabled box and the key with it.

const chord = (): KeyboardEvent =>
  new KeyboardEvent('keydown', {
    ctrlKey: true,
    altKey: true,
    key: 'm',
    code: 'KeyM',
    cancelable: true,
  });

const Owner = defineComponent({
  props: { disabled: { type: Boolean, default: false }, text: { type: String, default: '' } },
  setup(props) {
    const box = ref<HTMLTextAreaElement | null>(null);
    useFocusChord(box, 'Say');
    return () => h('textarea', { ref: box, disabled: props.disabled, value: props.text });
  },
});

test('focuses the box with the caret at the end, and stops at unmount', async () => {
  const wrapper = mount(Owner, { props: { text: 'hello' }, attachTo: document.body });
  const box = wrapper.find('textarea').element;
  // The title follows the box ref, which the watch sees on the next tick.
  await nextTick();
  expect(box.title).toMatch(/^Say \((⌃⌥M|Ctrl\+Alt\+M)\)$/u);
  const first = chord();
  window.dispatchEvent(first);
  expect(first.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(box);
  expect(box.selectionStart).toBe(5);
  expect(box.selectionEnd).toBe(5);
  // From the box itself the chord is the box's own, and left.
  const again = chord();
  box.dispatchEvent(again);
  window.dispatchEvent(again);
  expect(again.defaultPrevented).toBe(false);
  box.blur();
  wrapper.unmount();
  const after = chord();
  window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
  expect(document.activeElement).not.toBe(box);
});

test('a disabled box takes neither the focus nor the key', () => {
  const wrapper = mount(Owner, { props: { disabled: true }, attachTo: document.body });
  const box = wrapper.find('textarea').element;
  expect([box.disabled, box.hasAttribute('disabled')]).toEqual([true, true]);
  const event = chord();
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(document.activeElement).not.toBe(wrapper.find('textarea').element);
  wrapper.unmount();
});
