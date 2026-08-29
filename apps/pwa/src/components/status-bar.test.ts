import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import StatusBar from './StatusBar.vue';

test('names the connection state, the daemon, rate windows and the last error', () => {
  const windows = [
    { name: 'five_hour', utilisation: 0.42, resetsAt: '2026-01-01T05:00:00Z' },
    { name: 'seven_day', utilisation: 0.9, resetsAt: '2026-01-07T00:00:00Z' },
  ];
  const wrapper = mount(StatusBar, {
    props: { status: 'connected', daemon: 'box', error: 'oops', push: 'on', rateWindows: windows },
  });
  expect(wrapper.find('.status').text()).toBe('Connected to box');
  expect(wrapper.findAll('.window').map((w) => w.text())).toEqual(['5h 42%', '7d 90%']);
  expect(wrapper.findAll('.window.high').length).toBe(1);
  expect(wrapper.find('.error').text()).toBe('oops');
  expect(wrapper.find('.push').exists()).toBe(false);
});

// Claude also reports windows like `seven_day_overage_included`; on a phone there is room for
// one more label only when it is the window closest to running out.
test('an unknown window is shown, humanised, only when it is the most used', async () => {
  const known = [
    { name: 'five_hour', utilisation: 0.13, resetsAt: 'x' },
    { name: 'seven_day', utilisation: 0.24, resetsAt: 'x' },
  ];
  const extra = { name: 'seven_day_overage_included', utilisation: 0.2, resetsAt: 'x' };
  const wrapper = mount(StatusBar, {
    props: { status: 'connected', daemon: null, error: null, push: 'on', rateWindows: [] },
  });
  await wrapper.setProps({ rateWindows: [...known, extra] });
  expect(wrapper.findAll('.window').map((w) => w.text())).toEqual(['5h 13%', '7d 24%']);
  await wrapper.setProps({ rateWindows: [...known, { ...extra, utilisation: 0.45 }] });
  expect(wrapper.findAll('.window').map((w) => w.text())).toEqual([
    '5h 13%',
    '7d 24%',
    'seven day overage included 45%',
  ]);
});

// The edges of the max rule: nothing, one unknown window on its own, an unknown tied with a
// known one (both stay), and a name that is a property every object has.
test('the most-used rule holds at the edges', async () => {
  const wrapper = mount(StatusBar, {
    props: { status: 'connected', daemon: null, error: null, push: 'on', rateWindows: [] },
  });
  const shown = (): string[] => wrapper.findAll('.window').map((w) => w.text());
  expect(wrapper.find('.windows').exists()).toBe(false);
  await wrapper.setProps({
    rateWindows: [{ name: 'monthly_spend', utilisation: 0.5, resetsAt: 'x' }],
  });
  expect(shown()).toEqual(['monthly spend 50%']);
  await wrapper.setProps({
    rateWindows: [
      { name: 'five_hour', utilisation: 0.3, resetsAt: 'x' },
      { name: 'monthly_spend', utilisation: 0.3, resetsAt: 'x' },
    ],
  });
  expect(shown()).toEqual(['5h 30%', 'monthly spend 30%']);
  await wrapper.setProps({
    rateWindows: [
      { name: 'five_hour', utilisation: 0.9, resetsAt: 'x' },
      { name: 'constructor', utilisation: 0.1, resetsAt: 'x' },
    ],
  });
  expect(shown()).toEqual(['5h 90%']);
});

test('reports an empty room and a stopped connection without a daemon name', async () => {
  const wrapper = mount(StatusBar, {
    props: { status: 'no_host', daemon: 'box', error: null, push: 'unavailable', rateWindows: [] },
  });
  expect(wrapper.find('.status').text()).toBe('Box offline');
  await wrapper.setProps({ status: 'stopped' });
  expect(wrapper.find('.status').text()).toBe('Offline');
  expect(wrapper.find('.error').exists()).toBe(false);
});

test('offers to enable notifications only while push is off', async () => {
  const wrapper = mount(StatusBar, {
    props: { status: 'connected', daemon: null, error: null, push: 'off', rateWindows: [] },
  });
  await wrapper.find('.push').trigger('click');
  expect(wrapper.emitted('enablePush')).toEqual([[]]);
  await wrapper.setProps({ push: 'on' });
  expect(wrapper.find('.push').exists()).toBe(false);
});
