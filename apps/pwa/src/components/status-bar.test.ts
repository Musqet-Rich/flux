import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import StatusBar from './StatusBar.vue';

test('names the connection state, the daemon, rate windows and the last error', () => {
  const windows = [
    { name: '5h', utilisation: 0.42, resetsAt: '2026-01-01T05:00:00Z' },
    { name: '7d', utilisation: 0.9, resetsAt: '2026-01-07T00:00:00Z' },
  ];
  const wrapper = mount(StatusBar, {
    props: { status: 'connected', daemon: 'box', error: 'oops', rateWindows: windows },
  });
  expect(wrapper.find('.status').text()).toBe('Connected to box');
  expect(wrapper.findAll('.window').map((w) => w.text())).toEqual(['5h 42%', '7d 90%']);
  expect(wrapper.findAll('.window.high').length).toBe(1);
  expect(wrapper.find('.error').text()).toBe('oops');
});

test('reports an empty room and a stopped connection without a daemon name', async () => {
  const wrapper = mount(StatusBar, {
    props: { status: 'no_host', daemon: 'box', error: null, rateWindows: [] },
  });
  expect(wrapper.find('.status').text()).toBe('Box offline');
  await wrapper.setProps({ status: 'stopped' });
  expect(wrapper.find('.status').text()).toBe('Offline');
  expect(wrapper.find('.error').exists()).toBe(false);
});
