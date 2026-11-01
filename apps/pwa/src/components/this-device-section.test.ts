import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import ThisDeviceSection from './ThisDeviceSection.vue';

// Settings › This device's daemons (ADR 0037): "Pair another daemon" is reachable with one
// daemon paired, and "Unpair this device" asks first, in plain words, before the daemon is asked
// to forget this device and the device forgets it.

test('Unpair asks first, says what it costs, and on confirm revokes this device and forgets the daemon', async () => {
  const box = await pairedStore([], { 'devices.remove': () => ({}) });
  const wrapper = mount(ThisDeviceSection, {
    props: { store: box.store, visible: null },
    attachTo: document.body,
  });
  expect(wrapper.find('.daemons .hint').text()).toBe('Paired with box.');
  await wrapper.find('.unpair').trigger('click');
  const dialog = wrapper.find('[role="alertdialog"]');
  expect(dialog.find('h2').text()).toBe('Unpair this device from box?');
  expect(dialog.text()).toContain('flux pair');
  expect(dialog.text()).toContain('may not be easy to set up again');
  expect(dialog.text()).not.toContain('—');
  expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
  await dialog.find('.secondary').trigger('click');
  expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
  expect(box.calls('devices.remove')).toEqual([]);
  await wrapper.find('.unpair').trigger('click');
  await wrapper.find('[role="alertdialog"] .danger').trigger('click');
  await until(() => box.store.state.phase === 'unpaired');
  await flushPromises();
  expect(box.calls('devices.remove')).toEqual([{ deviceId: 'dev-1' }]);
  expect(box.store.state.error).toBeNull();
  expect(box.store.state.daemons).toEqual([]);
  wrapper.unmount();
  box.store.stop();
});

test('"Pair another daemon" is here with one daemon paired', async () => {
  const box = await pairedStore();
  const wrapper = mount(ThisDeviceSection, {
    props: { store: box.store, visible: null },
    attachTo: document.body,
  });
  const pair = wrapper.findAll('.daemons button').find((b) => b.text() === 'Pair another daemon');
  await pair?.trigger('click');
  expect(wrapper.find('[role="dialog"]').attributes('aria-label')).toBe('Pair another daemon');
  wrapper.unmount();
  box.store.stop();
});
