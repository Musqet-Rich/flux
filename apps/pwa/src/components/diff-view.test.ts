import type { FluxEvent } from '@flux/protocol';
import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import DiffView from './DiffView.vue';

const created: FluxEvent = {
  seq: 1,
  ts: '2026-01-01T00:00:00Z',
  session: 's1',
  type: 'session.created',
  payload: {
    repo: '/repos/r',
    worktree: '/w',
    branch: 'flux/one',
    base: 'abc123',
    agent: 'claude',
  },
};

const loaded = (wrapper: { vm: object }): Promise<void> =>
  until(() => Reflect.get(wrapper.vm, 'loading') === false);

const editorText = (wrapper: { find: (s: string) => { element: Element } }): string =>
  wrapper.find('.editor').element.shadowRoot?.querySelector('.cm-content')?.textContent ?? '';

test('diffs the base revision against the worktree, under the old name for a rename', async () => {
  const box = await pairedStore([created], {
    'git.show': () => ({ content: 'a\nb\n', binary: false }),
    'fs.read': () => ({ content: 'a\nB\nc\n', binary: false }),
  });
  const wrapper = mount(DiffView, {
    props: { store: box.store, session: 's1', path: 'src/a.ts', from: 'src/old.ts' },
    attachTo: document.body,
  });
  await loaded(wrapper);
  await flushPromises();
  expect(box.calls('git.show')).toEqual([{ session: 's1', path: 'src/old.ts', rev: 'abc123' }]);
  expect(box.calls('fs.read')).toEqual([{ session: 's1', path: 'src/a.ts' }]);
  expect(wrapper.find('.editor').classes()).not.toContain('hidden');
  expect(editorText(wrapper)).toContain('B');
  expect(wrapper.find('.hint').text()).toContain('Tap a line number');
  wrapper.unmount();
  box.store.stop();
});

test('a file the base does not have is an addition and renders in full', async () => {
  const box = await pairedStore([created], {
    'fs.read': () => ({ content: 'brand\nnew\n', binary: false }),
  });
  const wrapper = mount(DiffView, {
    props: { store: box.store, session: 's1', path: 'new.ts', from: null },
    attachTo: document.body,
  });
  await loaded(wrapper);
  await flushPromises();
  expect(wrapper.find('.notice').exists()).toBe(false);
  expect(editorText(wrapper)).toContain('brand');
  expect(editorText(wrapper)).toContain('new');
  wrapper.unmount();
  box.store.stop();
});

test('a binary file is refused, as is a base read that fails for another reason', async () => {
  const binary = await pairedStore([created], {
    'git.show': () => ({ content: '', binary: false }),
    'fs.read': () => ({ content: '', binary: true }),
  });
  const one = mount(DiffView, {
    props: { store: binary.store, session: 's1', path: 'img.png', from: null },
  });
  await loaded(one);
  await flushPromises();
  expect(one.find('.notice').text()).toBe('Binary file.');
  binary.store.stop();
  const offline = await pairedStore([created], {
    'git.show': () => ({ content: '', binary: false }),
  });
  await offline.store.open('s1');
  offline.store.stop();
  const two = mount(DiffView, {
    props: { store: offline.store, session: 's1', path: 'x.ts', from: null },
  });
  await loaded(two);
  await flushPromises();
  expect(two.find('.notice').text()).toBe('not connected');
});

test('without a session.created event there is nothing to diff against', async () => {
  const box = await pairedStore([]);
  const wrapper = mount(DiffView, {
    props: { store: box.store, session: 's1', path: 'x.ts', from: null },
  });
  await loaded(wrapper);
  await flushPromises();
  expect(wrapper.find('.notice').text()).toBe('Session has no base commit yet.');
  await wrapper.find('.toolbar button').trigger('click');
  expect(wrapper.emitted('back')).toEqual([[]]);
  await wrapper.find('.edit').trigger('click');
  expect(wrapper.emitted('edit')).toEqual([[]]);
  box.store.stop();
});
