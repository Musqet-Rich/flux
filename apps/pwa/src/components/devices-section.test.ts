import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import DevicesSection from './DevicesSection.vue';

const devices = [
  {
    deviceId: 'dev-1',
    name: 'phone',
    pairedAt: '2026-01-01T00:00:00Z',
    lastSeenAt: '2026-01-02T00:00:00Z',
    current: true,
  },
  { deviceId: 'dev-2', pairedAt: '2026-01-01T00:00:00Z', current: false },
];

test('lists devices with the current one marked, and revokes another after a confirm', async () => {
  const box = await pairedStore([], {
    'devices.list': () => devices,
    'devices.remove': () => ({}),
  });
  await box.store.refreshDevices();
  const wrapper = mount(DevicesSection, { props: { store: box.store } });
  expect(wrapper.findAll('.device').length).toBe(2);
  expect(wrapper.findAll('.label').map((l) => l.text())).toEqual(['phone', 'dev-2']);
  expect(wrapper.findAll('.current').length).toBe(1);
  expect(wrapper.find('.meta').text()).toContain('last seen');
  expect(wrapper.findAll('.meta')[1]?.text()).toContain('last seen never');
  expect(wrapper.find('.hint').text()).toContain('flux pair');
  await wrapper.findAll('.revoke')[1]?.trigger('click');
  expect(wrapper.find('.confirm').text()).toContain('Revoke?');
  await wrapper.find('.confirm .secondary').trigger('click');
  expect(wrapper.find('.confirm').exists()).toBe(false);
  await wrapper.findAll('.revoke')[1]?.trigger('click');
  await wrapper.find('.confirm .danger').trigger('click');
  await until(() => box.store.state.devices.length === 1);
  await flushPromises();
  expect(box.calls('devices.remove')).toEqual([{ deviceId: 'dev-2' }]);
  expect(wrapper.findAll('.device').length).toBe(1);
  expect(box.store.state.phase).toBe('paired');
  box.store.stop();
});

test('revoking this device lands on the pair screen', async () => {
  const box = await pairedStore([], {
    'devices.list': () => devices,
    'devices.remove': () => ({}),
  });
  await box.store.refreshDevices();
  const wrapper = mount(DevicesSection, { props: { store: box.store } });
  await wrapper.find('.revoke').trigger('click');
  expect(wrapper.find('.confirm').text()).toContain('pair again');
  await wrapper.find('.confirm .danger').trigger('click');
  await until(() => box.store.state.phase === 'unpaired');
  expect(box.calls('devices.remove')).toEqual([{ deviceId: 'dev-1' }]);
  expect(box.store.state.error).toContain('removed');
});
