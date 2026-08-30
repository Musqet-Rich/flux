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
  await wrapper.find('#flux-harness').setValue('pi');
  await wrapper.findAll('.trigger input')[2]?.setValue(true);
  expect(submit.text()).toBe('Save changes');
  expect(submit.attributes('disabled')).toBeUndefined();
  await wrapper.find('form').trigger('submit');
  await until(() => box.store.state.settings?.flux.reposDir === '/srv/repos');
  await flushPromises();
  expect(box.calls('settings.set')).toEqual([
    { flux: { reposDir: '/srv/repos', defaultHarness: 'pi', notifyOnDone: true } },
  ]);
  expect(submit.text()).toBe('Saved');
  box.store.stop();
});

const checked = { current: '1.0.0', latest: '1.2.0', available: true, verified: true };

test('offers a verified update from the box check, then shows progress and a failure', async () => {
  const box = await pairedStore([], {
    hello: () => ({ protocol: 2, daemon: 'box', sessions: [], version: '1.0.0' }),
    'settings.get': () => settingsFixture(),
    'daemon.checkUpdate': () => checked,
    'daemon.update': () => ({}),
  });
  await box.store.refreshSettings();
  const wrapper = mount(FluxSettingsForm, { props: { store: box.store } });
  await until(() => box.store.state.updateCheck !== null);
  await flushPromises();
  expect(wrapper.find('.update-status').text()).toContain('Update available: 1.2.0 — verified ✓');
  const button = wrapper.find('.update-btn');
  expect(button.exists()).toBe(true);
  expect(button.attributes('disabled')).toBeUndefined();
  await button.trigger('click');
  await until(() => box.calls('daemon.update').length === 1);
  await flushPromises();
  expect(box.calls('daemon.update')).toEqual([{ version: '1.2.0' }]);
  expect(box.store.state.update.target).toBe('1.2.0');
  expect(wrapper.find('.update-btn').exists()).toBe(false);
  expect(wrapper.find('.update .hint').text()).toContain('Updating');
  await box.relay.ephemeral({ type: 'update.failed', reason: 'download_failed' });
  await until(() => box.store.state.update.failed === 'download_failed');
  await flushPromises();
  expect(wrapper.find('.update-error').text()).toContain('download_failed');
  box.store.stop();
});

test('shows up to date when the box has nothing newer', async () => {
  const box = await pairedStore([], {
    'settings.get': () => settingsFixture(),
    'daemon.checkUpdate': () => ({
      current: '1.2.0',
      latest: '1.2.0',
      available: false,
      verified: null,
      reason: 'up_to_date',
    }),
  });
  await box.store.refreshSettings();
  const wrapper = mount(FluxSettingsForm, { props: { store: box.store } });
  await until(() => box.store.state.updateCheck !== null);
  await flushPromises();
  expect(wrapper.find('.update-current').text()).toBe('Up to date (1.2.0)');
  expect(wrapper.find('.update-btn').exists()).toBe(false);
  box.store.stop();
});

test('shows an available release but disables the button when the box could not verify it', async () => {
  const box = await pairedStore([], {
    'settings.get': () => settingsFixture(),
    'daemon.checkUpdate': () => ({
      current: '1.0.0',
      latest: '1.3.0',
      available: true,
      verified: false,
      reason: 'bad_signature',
    }),
  });
  await box.store.refreshSettings();
  const wrapper = mount(FluxSettingsForm, { props: { store: box.store } });
  await until(() => box.store.state.updateCheck !== null);
  await flushPromises();
  expect(wrapper.find('.update-status').text()).toContain('cannot verify (bad_signature)');
  expect(wrapper.find('.update-btn').attributes('disabled')).toBeDefined();
  box.store.stop();
});

test('degrades to a quiet notice when the daemon is too old to check', async () => {
  const box = await pairedStore([], { 'settings.get': () => settingsFixture() });
  await box.store.refreshSettings();
  const wrapper = mount(FluxSettingsForm, { props: { store: box.store } });
  await until(() => box.store.state.updateCheck !== null);
  await flushPromises();
  expect(wrapper.find('.update-unavailable').text()).toBe("Couldn't check for updates.");
  expect(wrapper.find('.update-btn').exists()).toBe(false);
  box.store.stop();
});

test('an unsaved edit survives the other section saving', async () => {
  const box = await pairedStore([], {
    'settings.get': () => settingsFixture(),
    'settings.set': () =>
      settingsFixture({
        flux: { ...settingsFixture().flux, notifyOnDone: true },
        harnessConfig: { claudeMd: 'new', settingsJson: '{}' },
      }),
  });
  await box.store.refreshSettings();
  const wrapper = mount(FluxSettingsForm, { props: { store: box.store } });
  await wrapper.find('#flux-repos').setValue('/typing');
  await box.store.saveSettings({ harnessConfig: { claudeMd: 'new' } });
  await flushPromises();
  expect(wrapper.find<HTMLInputElement>('#flux-repos').element.value).toBe('/typing');
  expect(wrapper.findAll<HTMLInputElement>('.trigger input')[2]?.element.checked).toBe(true);
  expect(wrapper.find('button[type=submit]').text()).toBe('Save changes');
  box.store.stop();
});
