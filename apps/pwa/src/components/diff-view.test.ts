import type { FluxEvent } from '@flux/protocol';
import { mount } from '@vue/test-utils';
import { expect, test, vi } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
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

test('diffs the base revision against the worktree and posts a line comment', async () => {
  const box = await pairedStore([created], {
    'git.show': () => ({ content: 'a\nb\n', binary: false }),
    'fs.read': () => ({ content: 'a\nB\nc\n', binary: false }),
  });
  const wrapper = mount(DiffView, {
    props: { store: box.store, session: 's1', path: 'src/a.ts' },
    attachTo: document.body,
  });
  await vi.waitFor(() => {
    expect(wrapper.find('.editor').classes()).not.toContain('hidden');
  });
  expect(box.calls('git.show')).toEqual([{ session: 's1', path: 'src/a.ts', rev: 'abc123' }]);
  expect(box.calls('fs.read')).toEqual([{ session: 's1', path: 'src/a.ts' }]);
  expect(wrapper.find('.editor').element.shadowRoot?.querySelector('.cm-editor')).not.toBeNull();
  expect(wrapper.find('.hint').text()).toContain('Tap a line number');
  wrapper.unmount();
  box.store.stop();
});

test('an unknown file at the base is an addition, and a binary file is refused', async () => {
  const box = await pairedStore([created], {
    'fs.read': () => ({ content: '', binary: true }),
  });
  const wrapper = mount(DiffView, {
    props: { store: box.store, session: 's1', path: 'img.png' },
  });
  await vi.waitFor(() => {
    expect(wrapper.find('.notice').text()).toBe('Binary file.');
  });
  expect(box.calls('git.show').length).toBe(1);
  box.store.stop();
});

test('without a session.created event there is nothing to diff against', async () => {
  const box = await pairedStore([]);
  const wrapper = mount(DiffView, {
    props: { store: box.store, session: 's1', path: 'x.ts' },
  });
  await vi.waitFor(() => {
    expect(wrapper.find('.notice').text()).toBe('Session has no base commit yet.');
  });
  await wrapper.find('.toolbar button').trigger('click');
  expect(wrapper.emitted('back')).toEqual([[]]);
  box.store.stop();
});
