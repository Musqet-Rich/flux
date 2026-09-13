import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';
import { defineComponent, h, ref } from 'vue';

import { useFocusChord } from './useFocusChord.ts';

// The chord puts the caret at the end of `box` while the owner is mounted and the device
// has it, takes the key only then, and leaves a disabled box and the key with it. The title
// given back names the chord, or the box alone when the chord is off. Under happy-dom the
// keyboard is a PC's (enter-key.ts reads the user agent), so the label is Ctrl+Alt+M.

const chord = (): KeyboardEvent =>
  new KeyboardEvent('keydown', {
    ctrlKey: true,
    altKey: true,
    key: 'm',
    code: 'KeyM',
    cancelable: true,
    bubbles: true,
  });

const Owner = defineComponent({
  props: {
    disabled: { type: Boolean, default: false },
    text: { type: String, default: '' },
    on: { type: Boolean, default: true },
  },
  setup(props) {
    const box = ref<HTMLTextAreaElement | null>(null);
    const title = useFocusChord(box, 'Say', () => props.on);
    return () =>
      h('textarea', { ref: box, disabled: props.disabled, value: props.text, title: title.value });
  },
});

test('focuses the box with the caret at the end, and stops at unmount', () => {
  const wrapper = mount(Owner, { props: { text: 'hello' }, attachTo: document.body });
  const box = wrapper.find('textarea').element;
  expect(box.title).toBe('Say (Ctrl+Alt+M)');
  const first = chord();
  window.dispatchEvent(first);
  expect(first.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(box);
  expect(box.selectionStart).toBe(5);
  expect(box.selectionEnd).toBe(5);
  // From the box itself the chord is the box's own, and left.
  const again = chord();
  box.dispatchEvent(again);
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
  const event = chord();
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(document.activeElement).not.toBe(wrapper.find('textarea').element);
  wrapper.unmount();
});

test('off, the key is left and the title is the box alone', async () => {
  const wrapper = mount(Owner, { props: { on: false }, attachTo: document.body });
  const box = wrapper.find('textarea').element;
  expect(box.title).toBe('Say');
  const event = chord();
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(document.activeElement).not.toBe(box);
  await wrapper.setProps({ on: true });
  expect(box.title).toBe('Say (Ctrl+Alt+M)');
  wrapper.unmount();
});
