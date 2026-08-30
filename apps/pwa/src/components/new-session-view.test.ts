import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { settingsFixture } from '../../test/settings-fixture.ts';
import { until } from '../../test/until.ts';
import NewSessionView from './NewSessionView.vue';

test('lists repos, creates the session, sends the first prompt and emits created', async () => {
  const box = await pairedStore([], {
    'repos.list': () => ({
      repos: [
        { path: '/repos/a', name: 'a', branches: ['main'] },
        { path: '/repos/b', name: 'b', branches: ['main'] },
      ],
    }),
    'sessions.create': (p) => ({
      session: 's9',
      title: `${p.title}`,
      repo: p.repo,
      branch: p.branch,
      harness: p.harness,
      state: 'idle',
      lastSeq: 0,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }),
    'agent.send': () => ({ seq: 1 }),
  });
  const wrapper = mount(NewSessionView, { props: { store: box.store } });
  await until(() => Reflect.get(wrapper.vm, 'repos').length === 2);
  await flushPromises();
  expect(wrapper.findAll('#new-repo option').length).toBe(2);
  expect(wrapper.find('#new-harness').exists()).toBe(false);
  expect(wrapper.find('button[type=submit]').attributes('disabled')).toBeDefined();
  await wrapper.find('select').setValue('/repos/b');
  await wrapper.find('#new-branch').setValue('feat/x');
  await wrapper.find('#new-title').setValue('Title');
  await wrapper.find('#new-prompt').setValue('Build it');
  expect(wrapper.find('button[type=submit]').attributes('disabled')).toBeUndefined();
  await wrapper.find('form').trigger('submit');
  await until(() => box.store.state.sessions.length === 2);
  await until(() => Reflect.get(wrapper.vm, 'busy') === false);
  expect(wrapper.emitted('created')).toEqual([['s9']]);
  expect(box.calls('sessions.create')).toEqual([
    { repo: '/repos/b', branch: 'feat/x', harness: 'claude', title: 'Title' },
  ]);
  expect(box.calls('agent.send')).toEqual([{ session: 's9', text: 'Build it' }]);
  expect(box.store.state.sessions.map((s) => s.session)).toEqual(['s1', 's9']);
  box.store.stop();
});

test('offers a harness picker only when the box has more than one, with model and effort, and sends the choice', async () => {
  const box = await pairedStore([], {
    hello: () => ({ protocol: 1, daemon: 'box', sessions: [], agents: ['claude', 'pi'] }),
    'repos.list': () => ({ repos: [{ path: '/repos/a', name: 'a', branches: ['main'] }] }),
    'sessions.create': (p) => ({
      session: 's9',
      title: p.branch,
      repo: p.repo,
      branch: p.branch,
      harness: p.harness,
      state: 'idle',
      lastSeq: 0,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }),
    'agent.send': () => ({ seq: 1 }),
  });
  const wrapper = mount(NewSessionView, { props: { store: box.store } });
  await until(() => Reflect.get(wrapper.vm, 'repos').length === 1);
  await flushPromises();
  expect(box.store.state.agents).toEqual(['claude', 'pi']);
  expect(wrapper.find('#new-harness').exists()).toBe(true);
  expect(wrapper.findAll('#new-harness option').map((o) => o.text())).toEqual([
    'Claude Code',
    'Pi',
  ]);
  await wrapper.find('#new-harness').setValue('pi');
  await wrapper.find('#new-model').setValue('sonnet');
  await wrapper.find('#new-effort').setValue('high');
  await wrapper.find('#new-prompt').setValue('go');
  await wrapper.find('form').trigger('submit');
  await until(() => box.calls('agent.send').length === 1);
  expect(box.calls('sessions.create')).toEqual([
    {
      repo: '/repos/a',
      branch: expect.stringMatching(/^flux\//u),
      harness: 'pi',
      model: 'sonnet',
      effort: 'high',
    },
  ]);
  box.store.stop();
});

test('shows the box error when creation fails', async () => {
  const box = await pairedStore([], {
    'repos.list': () => ({ repos: [{ path: '/repos/a', name: 'a', branches: [] }] }),
  });
  const wrapper = mount(NewSessionView, { props: { store: box.store } });
  await until(() => Reflect.get(wrapper.vm, 'repos').length === 1);
  await flushPromises();
  await wrapper.find('#new-prompt').setValue('go');
  await wrapper.find('form').trigger('submit');
  await until(() => Reflect.get(wrapper.vm, 'failure') === 'no sessions.create');
  await flushPromises();
  expect(wrapper.find('.error').text()).toBe('no sessions.create');
  expect(wrapper.emitted('created')).toBeUndefined();
  box.store.stop();
});

test('the picker follows the box default and the harness list, and says when the box has none', async () => {
  const box = await pairedStore([], {
    hello: () => ({ protocol: 1, daemon: 'box', sessions: [], agents: ['claude', 'pi'] }),
    'repos.list': () => ({ repos: [{ path: '/repos/a', name: 'a', branches: ['main'] }] }),
    'settings.get': () =>
      settingsFixture({ flux: { ...settingsFixture().flux, defaultHarness: 'pi' } }),
  });
  await box.store.refreshSettings();
  const wrapper = mount(NewSessionView, { props: { store: box.store } });
  await until(() => Reflect.get(wrapper.vm, 'repos').length === 1);
  await flushPromises();
  expect(wrapper.find<HTMLSelectElement>('#new-harness').element.value).toBe('pi');
  box.store.state.agents = ['claude'];
  await flushPromises();
  expect(wrapper.find('#new-harness').exists()).toBe(false);
  expect(Reflect.get(wrapper.vm, 'harness')).toBe('claude');
  box.store.state.agents = [];
  await flushPromises();
  expect(wrapper.find('.error').text()).toContain('No harness found on the box');
  await wrapper.find('#new-prompt').setValue('go');
  expect(wrapper.find('button[type=submit]').attributes('disabled')).toBeDefined();
  box.store.stop();
});

const withAgents = () =>
  pairedStore([], {
    'repos.list': () => ({ repos: [{ path: '/repos/a', name: 'a', branches: ['main'] }] }),
    'settings.get': () =>
      settingsFixture({ agents: [{ name: 'reviewer', model: 'opus', effort: 'high', role: 't' }] }),
    'sessions.create': (p) => ({
      session: 's9',
      title: p.branch,
      repo: p.repo,
      branch: p.branch,
      harness: p.harness,
      state: 'idle' as const,
      lastSeq: 0,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }),
    'agent.send': () => ({ seq: 1 }),
  });

test('an agent picker prefills model and effort and sends the agent name', async () => {
  const box = await withAgents();
  const wrapper = mount(NewSessionView, { props: { store: box.store } });
  await until(() => Reflect.get(wrapper.vm, 'agents').length === 1);
  await flushPromises();
  expect(wrapper.find('#new-agent').exists()).toBe(true);
  await wrapper.find('#new-agent').setValue('reviewer');
  expect(wrapper.find<HTMLInputElement>('#new-model').element.value).toBe('opus');
  expect(wrapper.find<HTMLInputElement>('#new-effort').element.value).toBe('high');
  await wrapper.find('#new-prompt').setValue('go');
  await wrapper.find('form').trigger('submit');
  await until(() => box.calls('agent.send').length === 1);
  expect(box.calls('sessions.create')).toEqual([
    {
      repo: '/repos/a',
      branch: expect.stringMatching(/^flux\//u),
      harness: 'claude',
      agent: 'reviewer',
      model: 'opus',
      effort: 'high',
    },
  ]);
  box.store.stop();
});

test('leaving the agent picker on None omits agent on create', async () => {
  const box = await withAgents();
  const wrapper = mount(NewSessionView, { props: { store: box.store } });
  await until(() => Reflect.get(wrapper.vm, 'agents').length === 1);
  await flushPromises();
  await wrapper.find('#new-prompt').setValue('go');
  await wrapper.find('form').trigger('submit');
  await until(() => box.calls('agent.send').length === 1);
  expect(box.calls('sessions.create')[0]).not.toHaveProperty('agent');
  box.store.stop();
});
