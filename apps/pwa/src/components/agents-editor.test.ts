import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { settingsFixture } from '../../test/settings-fixture.ts';
import { until } from '../../test/until.ts';
import AgentsEditor from './AgentsEditor.vue';

test('lists saved agents, adds one, and sends the whole list on save', async () => {
  const saved = [
    { name: 'reviewer', model: 'opus' },
    { name: 'writer', harness: 'pi' as const, role: 'be kind' },
  ];
  const box = await pairedStore([], {
    'settings.get': () => settingsFixture({ agents: [{ name: 'reviewer', model: 'opus' }] }),
    'settings.set': () => settingsFixture({ agents: saved }),
  });
  await box.store.refreshSettings();
  const wrapper = mount(AgentsEditor, { props: { store: box.store } });
  expect(wrapper.findAll('.agent-row').length).toBe(1);
  expect(wrapper.find<HTMLInputElement>('.agent-name').element.value).toBe('reviewer');
  expect(wrapper.find<HTMLInputElement>('.agent-model').element.value).toBe('opus');
  expect(wrapper.find('button[type=submit]').attributes('disabled')).toBeDefined();
  await wrapper.find('.agent-add').trigger('click');
  await wrapper.findAll('.agent-row')[1]?.find('.agent-name').setValue('writer');
  await wrapper.findAll('.agent-row')[1]?.find('.agent-harness').setValue('pi');
  await wrapper.findAll('.agent-row')[1]?.find('.agent-role').setValue('be kind');
  expect(wrapper.find('button[type=submit]').attributes('disabled')).toBeUndefined();
  await wrapper.find('form').trigger('submit');
  await until(() => box.calls('settings.set').length === 1);
  await flushPromises();
  expect(box.calls('settings.set')).toEqual([{ agents: saved }]);
  expect(wrapper.find('button[type=submit]').attributes('disabled')).toBeDefined();
  box.store.stop();
});

test('flags a blank name and a duplicate name and blocks save', async () => {
  const box = await pairedStore([], {
    'settings.get': () => settingsFixture({ agents: [{ name: 'a' }] }),
  });
  await box.store.refreshSettings();
  const wrapper = mount(AgentsEditor, { props: { store: box.store } });
  await wrapper.find('.agent-add').trigger('click');
  expect(wrapper.find('.notice').text()).toBe('Every agent needs a name.');
  expect(wrapper.find('button[type=submit]').attributes('disabled')).toBeDefined();
  await wrapper.findAll('.agent-name')[1]?.setValue('a');
  expect(wrapper.find('.notice').text()).toBe('Agent names must be unique.');
  expect(wrapper.find('button[type=submit]').attributes('disabled')).toBeDefined();
  box.store.stop();
});

test('emits mode none as { mode: none } and a note names the Flux tools', async () => {
  const box = await pairedStore([], {
    'settings.get': () => settingsFixture({ agents: [{ name: 'ro' }] }),
    'settings.set': () => settingsFixture({ agents: [{ name: 'ro' }] }),
  });
  await box.store.refreshSettings();
  const wrapper = mount(AgentsEditor, { props: { store: box.store } });
  expect(wrapper.find('.tools-note').text()).toContain('flux_ask and flux_notify');
  await wrapper.find('.tools-mode').setValue('none');
  await wrapper.find('form').trigger('submit');
  await until(() => box.calls('settings.set').length === 1);
  await flushPromises();
  expect(box.calls('settings.set')).toEqual([
    { agents: [{ name: 'ro', tools: { mode: 'none' } }] },
  ]);
  box.store.stop();
});

test('an allow-list carries its parsed tool names, comma- or newline-separated', async () => {
  const box = await pairedStore([], {
    'settings.get': () => settingsFixture({ agents: [{ name: 'ro' }] }),
    'settings.set': () => settingsFixture({ agents: [{ name: 'ro' }] }),
  });
  await box.store.refreshSettings();
  const wrapper = mount(AgentsEditor, { props: { store: box.store } });
  await wrapper.find('.tools-mode').setValue('allow');
  await wrapper.find('.tools-list').setValue('Bash, Edit\nRead');
  await wrapper.find('form').trigger('submit');
  await until(() => box.calls('settings.set').length === 1);
  await flushPromises();
  expect(box.calls('settings.set')).toEqual([
    { agents: [{ name: 'ro', tools: { mode: 'allow', list: ['Bash', 'Edit', 'Read'] } }] },
  ]);
  box.store.stop();
});

test('blocks save when an allow-list or deny-list has no tool names', async () => {
  const box = await pairedStore([], {
    'settings.get': () => settingsFixture({ agents: [{ name: 'ro' }] }),
  });
  await box.store.refreshSettings();
  const wrapper = mount(AgentsEditor, { props: { store: box.store } });
  await wrapper.find('.tools-mode').setValue('deny');
  expect(wrapper.find('.notice').text()).toBe('An allow-list or deny-list needs a tool name.');
  expect(wrapper.find('button[type=submit]').attributes('disabled')).toBeDefined();
  box.store.stop();
});

test('the manager checkbox writes manager:true into the saved Agent (ADR 0025)', async () => {
  const box = await pairedStore([], {
    'settings.get': () => settingsFixture({ agents: [{ name: 'boss' }] }),
    'settings.set': () => settingsFixture({ agents: [{ name: 'boss', manager: true }] }),
  });
  await box.store.refreshSettings();
  const wrapper = mount(AgentsEditor, { props: { store: box.store } });
  expect(wrapper.find<HTMLInputElement>('.agent-manager').element.checked).toBe(false);
  await wrapper.find('.agent-manager').setValue(true);
  expect(wrapper.find('.manager-note').text()).toContain('open, message, read and archive');
  await wrapper.find('form').trigger('submit');
  await until(() => box.calls('settings.set').length === 1);
  await flushPromises();
  expect(box.calls('settings.set')).toEqual([{ agents: [{ name: 'boss', manager: true }] }]);
  box.store.stop();
});

test('an unchecked manager omits the field entirely', async () => {
  const box = await pairedStore([], {
    'settings.get': () => settingsFixture({ agents: [{ name: 'boss', manager: true }] }),
    'settings.set': () => settingsFixture({ agents: [{ name: 'boss' }] }),
  });
  await box.store.refreshSettings();
  const wrapper = mount(AgentsEditor, { props: { store: box.store } });
  expect(wrapper.find<HTMLInputElement>('.agent-manager').element.checked).toBe(true);
  await wrapper.find('.agent-manager').setValue(false);
  await wrapper.find('form').trigger('submit');
  await until(() => box.calls('settings.set').length === 1);
  await flushPromises();
  expect(box.calls('settings.set')).toEqual([{ agents: [{ name: 'boss' }] }]);
  box.store.stop();
});

test('deletes an agent and sends the shortened list', async () => {
  const box = await pairedStore([], {
    'settings.get': () => settingsFixture({ agents: [{ name: 'a' }, { name: 'b' }] }),
    'settings.set': () => settingsFixture({ agents: [{ name: 'b' }] }),
  });
  await box.store.refreshSettings();
  const wrapper = mount(AgentsEditor, { props: { store: box.store } });
  expect(wrapper.findAll('.agent-row').length).toBe(2);
  await wrapper.findAll('.agent-delete')[0]?.trigger('click');
  expect(wrapper.findAll('.agent-row').length).toBe(1);
  await wrapper.find('form').trigger('submit');
  await until(() => box.calls('settings.set').length === 1);
  await flushPromises();
  expect(box.calls('settings.set')).toEqual([{ agents: [{ name: 'b' }] }]);
  box.store.stop();
});
