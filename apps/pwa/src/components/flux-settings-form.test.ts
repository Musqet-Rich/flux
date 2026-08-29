import type { Settings } from '@flux/protocol';
import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { settingsFixture } from '../../test/settings-fixture.ts';
import { until } from '../../test/until.ts';
import FluxSettingsForm from './FluxSettingsForm.vue';

test('shows the settings, enables Save once edited, sends the form and shows env read-only', async () => {
  let current: Settings = settingsFixture();
  const box = await pairedStore([], {
    'settings.get': () => current,
    'settings.set': (p) => {
      current = { ...current, flux: { ...current.flux, ...p.flux } };
      return current;
    },
  });
  const wrapper = mount(FluxSettingsForm, { props: { store: box.store } });
  expect(wrapper.find('.hint').text()).toBe('Loading…');
  await box.store.refreshSettings();
  await flushPromises();
  const submit = wrapper.find('button[type=submit]');
  expect(submit.text()).toBe('Saved');
  expect(submit.attributes('disabled')).toBeDefined();
  expect(wrapper.find<HTMLInputElement>('#flux-repos').element.value).toBe('/home/flux/repos');
  expect(wrapper.findAll('dd').map((d) => d.text())).toEqual([
    'https://relay.example',
    '/home/flux/.flux',
    'flux@box',
    'mailto:ops@example.com',
    'claude',
  ]);
  await wrapper.find('#flux-repos').setValue('/srv/repos');
  await wrapper.find('#flux-agent').setValue('pi');
  await wrapper.findAll('.trigger input')[2]?.setValue(true);
  expect(submit.text()).toBe('Save changes');
  expect(submit.attributes('disabled')).toBeUndefined();
  await wrapper.find('form').trigger('submit');
  await until(() => box.store.state.settings?.flux.reposDir === '/srv/repos');
  await flushPromises();
  expect(box.calls('settings.set')).toEqual([
    { flux: { reposDir: '/srv/repos', defaultAgent: 'pi', notifyOnDone: true } },
  ]);
  expect(submit.text()).toBe('Saved');
  box.store.stop();
});

test('an unsaved edit survives the other section saving', async () => {
  const box = await pairedStore([], {
    'settings.get': () => settingsFixture(),
    'settings.set': () =>
      settingsFixture({
        flux: { ...settingsFixture().flux, notifyOnDone: true },
        agent: { claudeMd: 'new', settingsJson: '{}' },
      }),
  });
  await box.store.refreshSettings();
  const wrapper = mount(FluxSettingsForm, { props: { store: box.store } });
  await wrapper.find('#flux-repos').setValue('/typing');
  await box.store.saveSettings({ agent: { claudeMd: 'new' } });
  await flushPromises();
  expect(wrapper.find<HTMLInputElement>('#flux-repos').element.value).toBe('/typing');
  expect(wrapper.findAll<HTMLInputElement>('.trigger input')[2]?.element.checked).toBe(true);
  expect(wrapper.find('button[type=submit]').text()).toBe('Save changes');
  box.store.stop();
});
