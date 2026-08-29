import type { RateWindow } from '@flux/protocol';
import { mount } from '@vue/test-utils';
import { expect, test, vi } from 'vitest';

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

const base = {
  status: 'connected' as const,
  daemon: null,
  error: null,
  push: 'on' as const,
  rateWindows: [] as RateWindow[],
};

test('shows the open session context, adding a percentage when the window is known', async () => {
  const wrapper = mount(StatusBar, {
    props: { ...base, context: { tokens: 238560, window: null } },
  });
  expect(wrapper.find('.ctx').text()).toBe('ctx 239k');
  await wrapper.setProps({ context: { tokens: 238560, window: 1_000_000 } });
  expect(wrapper.find('.ctx').text()).toBe('ctx 239k · 24%');
});

test('a context with no reading at all is absent, a small one shows raw tokens', async () => {
  const wrapper = mount(StatusBar, { props: base });
  expect(wrapper.find('.ctx').exists()).toBe(false);
  await wrapper.setProps({ context: { tokens: 512, window: null } });
  expect(wrapper.find('.ctx').text()).toBe('ctx 512');
});

test.each([
  [690_000, ['ctx']],
  [700_000, ['ctx', 'amber']],
  [850_000, ['ctx', 'amber']],
  [900_000, ['ctx', 'red']],
  [990_000, ['ctx', 'red']],
])('context %d of 1M gets classes %j', (tokens, expected) => {
  const wrapper = mount(StatusBar, {
    props: { ...base, context: { tokens, window: 1_000_000 } },
  });
  expect(wrapper.find('.ctx').classes().toSorted()).toEqual([...expected].toSorted());
});

test('a window shows a relative renewal and taps to swap for absolute times', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-29T12:00:00.000Z'));
  const wrapper = mount(StatusBar, {
    props: {
      ...base,
      rateWindows: [{ name: 'five_hour', utilisation: 0.29, resetsAt: '2026-08-29T14:10:00.000Z' }],
    },
  });
  expect(wrapper.find('.window').text()).toBe('5h 29%');
  expect(wrapper.find('.renew').text()).toBe('↻ 2h10m');
  expect(wrapper.find('.absolute').exists()).toBe(false);
  await wrapper.find('.windows').trigger('click');
  expect(wrapper.find('.absolute').exists()).toBe(true);
  expect(wrapper.findAll('.at')).toHaveLength(1);
  await wrapper.find('.windows').trigger('click');
  expect(wrapper.find('.absolute').exists()).toBe(false);
  vi.useRealTimers();
});

test('the renewal counts down once a minute and the clock stops with the component', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-29T12:00:00.000Z'));
  const wrapper = mount(StatusBar, {
    props: {
      ...base,
      rateWindows: [{ name: 'five_hour', utilisation: 0.29, resetsAt: '2026-08-29T14:10:00.000Z' }],
    },
  });
  expect(wrapper.find('.renew').text()).toBe('↻ 2h10m');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(wrapper.find('.renew').text()).toBe('↻ 2h9m');
  await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
  expect(wrapper.find('.renew').text()).toBe('↻ 9m');
  expect(vi.getTimerCount()).toBe(1);
  wrapper.unmount();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

test('the most used window is the binding one, whose renewal a narrow bar keeps', () => {
  const wrapper = mount(StatusBar, {
    props: {
      ...base,
      rateWindows: [
        { name: 'five_hour', utilisation: 0.29, resetsAt: '2999-01-01T00:00:00.000Z' },
        { name: 'seven_day', utilisation: 0.61, resetsAt: '2999-01-02T00:00:00.000Z' },
      ],
    },
  });
  const renewals = wrapper.findAll('.renew');
  expect(renewals.map((r) => r.classes('binding'))).toEqual([false, true]);
});

test('a window whose reset time is unparseable shows no renewal', () => {
  const wrapper = mount(StatusBar, {
    props: { ...base, rateWindows: [{ name: 'five_hour', utilisation: 0.29, resetsAt: 'x' }] },
  });
  expect(wrapper.find('.window').text()).toBe('5h 29%');
  expect(wrapper.find('.renew').exists()).toBe(false);
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
