import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { settingsFixture } from '../../test/settings-fixture.ts';
import { until } from '../../test/until.ts';
import AgentConfigEditor from './AgentConfigEditor.vue';

test('marks edited files, refuses bad JSON, and sends only what changed', async () => {
  const box = await pairedStore([], {
    'settings.get': () => settingsFixture(),
    'settings.set': () =>
      settingsFixture({ agent: { claudeMd: '# New rules\n', settingsJson: '{}' } }),
  });
  await box.store.refreshSettings();
  const wrapper = mount(AgentConfigEditor, { props: { store: box.store } });
  expect(wrapper.find<HTMLTextAreaElement>('#agent-md').element.value).toBe('# Rules\n');
  expect(wrapper.findAll('.dirty').length).toBe(0);
  const submit = wrapper.find('button[type=submit]');
  expect(submit.attributes('disabled')).toBeDefined();
  await wrapper.find('#agent-json').setValue('{"model":');
  expect(wrapper.findAll('.dirty').length).toBe(1);
  expect(wrapper.find('.error').exists()).toBe(true);
  expect(wrapper.find('#agent-json').classes()).toContain('invalid');
  expect(submit.attributes('disabled')).toBeDefined();
  await wrapper.find('#agent-json').setValue('{"model":"opus"}');
  expect(wrapper.find('.error').exists()).toBe(false);
  expect(wrapper.findAll('.dirty').length).toBe(0);
  await wrapper.find('#agent-md').setValue('# New rules\n');
  expect(submit.attributes('disabled')).toBeUndefined();
  await wrapper.find('form').trigger('submit');
  await until(() => box.store.state.settings?.agent.claudeMd === '# New rules\n');
  await flushPromises();
  expect(box.calls('settings.set')).toEqual([{ agent: { claudeMd: '# New rules\n' } }]);
  expect(wrapper.find<HTMLTextAreaElement>('#agent-json').element.value).toBe('{}');
  expect(submit.attributes('disabled')).toBeDefined();
  box.store.stop();
});

test('an unsaved edit survives the other section saving, and empty JSON is refused', async () => {
  const box = await pairedStore([], {
    'settings.get': () => settingsFixture(),
    'settings.set': () =>
      settingsFixture({
        flux: { ...settingsFixture().flux, defaultAgent: 'pi' },
        agent: { claudeMd: '# Rules\n', settingsJson: '{"model":"opus","x":1}' },
      }),
  });
  await box.store.refreshSettings();
  const wrapper = mount(AgentConfigEditor, { props: { store: box.store } });
  await wrapper.find('#agent-md').setValue('typing…');
  await box.store.saveSettings({ flux: { defaultAgent: 'pi' } });
  await flushPromises();
  expect(wrapper.find<HTMLTextAreaElement>('#agent-md').element.value).toBe('typing…');
  expect(wrapper.find<HTMLTextAreaElement>('#agent-json').element.value).toBe(
    '{"model":"opus","x":1}',
  );
  await wrapper.find('#agent-json').setValue('');
  expect(wrapper.find('.error').text()).toBe('settings.json cannot be empty');
  await wrapper.find('#agent-json').setValue('[]');
  expect(wrapper.find('.error').text()).toBe('settings.json must be a JSON object');
  expect(wrapper.find('button[type=submit]').attributes('disabled')).toBeDefined();
  box.store.stop();
});

test('shows the box error when a save is refused', async () => {
  const box = await pairedStore([], { 'settings.get': () => settingsFixture() });
  await box.store.refreshSettings();
  const wrapper = mount(AgentConfigEditor, { props: { store: box.store } });
  await wrapper.find('#agent-md').setValue('changed');
  await wrapper.find('form').trigger('submit');
  await until(() => box.store.state.error?.message === 'no settings.set');
  await flushPromises();
  expect(wrapper.find('.error').text()).toBe('no settings.set');
  box.store.stop();
});
