import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import UnknownDevice from './UnknownDevice.vue';

// The banner for an open daemon that no longer knows this device (ADR 0037): absent while it
// does, worded for a `not_paired` answer or an unanswered handshake, and a Forget that asks once
// more before it forgets the daemon here alone.

test('stays away while the daemon knows this device, and says which way it does not', async () => {
  const box = await pairedStore([], { 'devices.remove': () => ({}) });
  const wrapper = mount(UnknownDevice, { props: { store: box.store } });
  expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  box.store.state.unknownDevice = 'unanswered';
  await flushPromises();
  expect(wrapper.find('.what').text()).toContain('box is not answering this device');
  box.store.state.unknownDevice = 'not_paired';
  await flushPromises();
  expect(wrapper.find('.what').text()).toBe('box no longer knows this device.');
  expect(wrapper.find('.hint').text()).toContain('flux pair');
  expect(wrapper.text()).not.toContain('—');
  wrapper.unmount();
  box.store.stop();
});

test('Forget asks once more, then forgets the daemon here without asking it', async () => {
  const box = await pairedStore([], { 'devices.remove': () => ({}) });
  const wrapper = mount(UnknownDevice, { props: { store: box.store } });
  box.store.state.unknownDevice = 'not_paired';
  await flushPromises();
  await wrapper.find('.forget').trigger('click');
  expect(wrapper.find('.actions').text()).toContain('Forget box on this device?');
  await wrapper.find('.actions .secondary').trigger('click');
  expect(box.store.state.phase).toBe('paired');
  await wrapper.find('.forget').trigger('click');
  await wrapper.find('.actions .danger').trigger('click');
  await until(() => box.store.state.phase === 'unpaired');
  expect(box.calls('devices.remove')).toEqual([]);
  wrapper.unmount();
  box.store.stop();
});
