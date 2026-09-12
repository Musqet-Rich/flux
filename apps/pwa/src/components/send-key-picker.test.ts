import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import SendKeyPicker from './SendKeyPicker.vue';

test('offers the four chords in the keyboard terms of the device and applies a pick at once', async () => {
  const box = await pairedStore();
  const wrapper = mount(SendKeyPicker, { props: { store: box.store } });
  const select = wrapper.find<HTMLSelectElement>('#flux-send-key');
  expect(select.element.value).toBe('meta');
  // happy-dom's user agent is not a Mac's, so the labels are the PC ones.
  expect(wrapper.findAll('option').map((o) => o.text())).toEqual([
    'Enter',
    'Ctrl+Enter',
    'Alt+Enter',
    'Shift+Enter',
  ]);
  expect(wrapper.find('.hint').text()).not.toContain('phone');
  await select.setValue('enter');
  await flushPromises();
  expect(box.store.state.sendKey).toBe('enter');
  expect(wrapper.find('.hint').text()).toContain('on a phone there is no way to start one');
  expect(select.attributes('aria-describedby')).toBe(wrapper.find('.hint').attributes('id'));
  box.store.stop();
});
