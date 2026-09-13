import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import SwitchKeyPicker from './SwitchKeyPicker.vue';

test('offers the chords in the keyboard terms of the device, with the cost of the pick as its hint', async () => {
  const box = await pairedStore();
  const wrapper = mount(SwitchKeyPicker, { props: { store: box.store } });
  const select = wrapper.find<HTMLSelectElement>('#flux-switch-key');
  expect(select.element.value).toBe('ctrlAlt');
  // happy-dom's user agent is not a Mac's, so the labels are the PC ones, ⌘⌥ folded into ⌃⌥.
  expect(wrapper.findAll('option').map((o) => o.text())).toEqual([
    'Ctrl+Alt+← →',
    'Alt+↑ ↓',
    'Ctrl+Shift+← →',
    'Alt+← →',
    'Ctrl+← →',
    'Shift+← →',
    'Off',
  ]);
  expect(wrapper.find('.hint').text()).toBe('Steps along the session tabs, wrapping at the ends.');
  await select.setValue('alt');
  await flushPromises();
  expect(box.store.state.switchKey).toBe('alt');
  expect(wrapper.find('.hint').text()).toContain('moves by word');
  expect(select.attributes('aria-describedby')).toBe(wrapper.find('.hint').attributes('id'));
  box.store.stop();
});
