import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import { settingsFixture } from '../../test/settings-fixture.ts';
import SettingsView from './SettingsView.vue';

test('fetches devices and settings on open, shows every section, and goes back', async () => {
  const box = await pairedStore([], {
    'devices.list': () => [
      { deviceId: 'dev-1', name: 'phone', pairedAt: '2026-01-01T00:00:00Z', current: true },
    ],
    'settings.get': () => settingsFixture(),
  });
  const wrapper = mount(SettingsView, { props: { store: box.store } });
  await until(() => box.store.state.settings !== null);
  await until(() => box.store.state.devices.length === 1);
  await flushPromises();
  expect(wrapper.findAll('h2').map((h) => h.text())).toEqual([
    'Devices',
    'Flux',
    'Agents',
    'Harness config',
  ]);
  expect(wrapper.find('.device .label').text()).toBe('phone');
  expect(wrapper.find('#flux-repos').element).toBeInstanceOf(HTMLInputElement);
  expect(wrapper.find('#harness-md').element).toBeInstanceOf(HTMLTextAreaElement);
  await wrapper.find('.toolbar button').trigger('click');
  expect(wrapper.emitted('back')).toEqual([[]]);
  box.store.stop();
});
