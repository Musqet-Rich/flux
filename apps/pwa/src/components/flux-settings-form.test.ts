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
    hello: () => ({ protocol: 1, daemon: 'box', sessions: [], agents: ['claude', 'pi'] }),
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
  expect(wrapper.findAll('.env dd').map((d) => d.text())).toEqual([
    'https://relay.example',
    '/home/flux/.flux',
    'flux@box',
    'mailto:ops@example.com',
    'claude',
  ]);
  // The version rows are read-only; the hello mock sends no version, so the daemon's reads
  // `unknown` (an older daemon), and this app's own build version is always a non-empty string.
  expect(wrapper.findAll('.versions dt').map((d) => d.text())).toEqual([
    'Daemon version',
    'App version',
  ]);
  const versions = wrapper.findAll('.versions dd').map((d) => d.text());
  expect(versions[0]).toBe('unknown');
  expect(versions[1]).not.toBe('');
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

test('offers a daemon update when the box is behind, then shows progress and a failure', async () => {
  const box = await pairedStore([], {
    hello: () => ({ protocol: 2, daemon: 'box', sessions: [], version: '0.0.0-dev' }),
    'settings.get': () => settingsFixture(),
    'daemon.update': () => ({}),
  });
  await box.store.refreshSettings();
  const wrapper = mount(FluxSettingsForm, { props: { store: box.store } });
  await flushPromises();
  const button = wrapper.find('.update-btn');
  expect(button.exists()).toBe(true);
  expect(button.text()).toContain('Update daemon to');
  await button.trigger('click');
  await until(() => box.store.state.update.target !== null);
  await flushPromises();
  expect(wrapper.find('.update-btn').exists()).toBe(false);
  expect(wrapper.find('.update .hint').text()).toContain('Updating');
  await box.relay.ephemeral({ type: 'update.failed', reason: 'download_failed' });
  await until(() => box.store.state.update.failed === 'download_failed');
  await flushPromises();
  expect(wrapper.find('.update-error').text()).toContain('download_failed');
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
