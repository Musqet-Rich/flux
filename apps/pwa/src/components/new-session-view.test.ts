import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
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
      agent: p.agent,
      state: 'idle',
      lastSeq: 0,
      updatedAt: '2026-01-01T00:00:00Z',
    }),
    'agent.send': () => ({ seq: 1 }),
  });
  const wrapper = mount(NewSessionView, { props: { store: box.store } });
  await until(() => Reflect.get(wrapper.vm, 'repos').length === 2);
  await flushPromises();
  expect(wrapper.findAll('option').length).toBe(2);
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
    { repo: '/repos/b', branch: 'feat/x', agent: 'claude', title: 'Title' },
  ]);
  expect(box.calls('agent.send')).toEqual([{ session: 's9', text: 'Build it' }]);
  expect(box.store.state.sessions.map((s) => s.session)).toEqual(['s1', 's9']);
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
