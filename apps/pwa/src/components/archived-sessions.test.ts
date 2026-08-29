import type { SessionSummary } from '@flux/protocol';
import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import ArchivedSessions from './ArchivedSessions.vue';

const s = (session: string, extra: Partial<SessionSummary>): SessionSummary => ({
  session,
  title: `T ${session}`,
  repo: '/r',
  branch: `b/${session}`,
  agent: 'claude',
  state: 'idle',
  lastSeq: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...extra,
});

const settled = async (wrapper: ReturnType<typeof mount>): Promise<void> => {
  await until(() => Reflect.get(wrapper.vm, 'busy') === false);
  await flushPromises();
};

const setup = async () => {
  const box = await pairedStore([], {
    'sessions.unarchive': () => ({}),
    'sessions.archive': () => ({}),
    'sessions.list': () => [s('a', { archived: false })],
  });
  box.store.state.sessions = [
    s('a', { archived: false }),
    s('b', { archived: true, worktreeExists: true, updatedAt: '2026-01-02T00:00:00Z' }),
    s('c', { archived: true, worktreeExists: false }),
  ];
  const wrapper = mount(ArchivedSessions, { props: { store: box.store } });
  return { ...box, wrapper };
};

test('lists archived sessions folded away; reopen only when the worktree is there', async () => {
  const { wrapper, calls, store } = await setup();
  expect(wrapper.find('summary').text()).toBe('Archived (2)');
  const rows = wrapper.findAll('.row');
  expect(rows.map((r) => r.find('.title').text())).toEqual(['T b', 'T c']);
  const reopen = rows.map((r) => r.findAll('button')[0]);
  expect(reopen[0]?.attributes('disabled')).toBeUndefined();
  expect(reopen[1]?.attributes('disabled')).toBeDefined();
  expect(reopen[1]?.attributes('title')).toMatch(/worktree is gone/u);
  expect(rows[1]?.classes()).toContain('gone');
  await reopen[0]?.trigger('click');
  await until(() => calls('sessions.unarchive').length === 1);
  expect(calls('sessions.unarchive')).toEqual([{ session: 'b' }]);
  await until(() => calls('sessions.list').length === 1);
  await settled(wrapper);
  expect(wrapper.emitted('reopened')).toEqual([['b']]);
  store.stop();
});

test('delete from the list goes through the same confirm', async () => {
  const { wrapper, calls, store } = await setup();
  await wrapper.findAll('.row')[1]?.findAll('button')[1]?.trigger('click');
  expect(wrapper.findAll('form.confirm')).toHaveLength(1);
  await wrapper.find('form.confirm').trigger('submit');
  await until(() => calls('sessions.archive').length === 1);
  expect(calls('sessions.archive')).toEqual([
    { session: 'c', removeWorktree: true, deleteBranch: false, discard: false },
  ]);
  await until(() => calls('sessions.list').length === 1);
  await settled(wrapper);
  expect(wrapper.find('form.confirm').exists()).toBe(false);
  store.stop();
});

test('nothing archived, nothing shown', async () => {
  const box = await pairedStore([]);
  const wrapper = mount(ArchivedSessions, { props: { store: box.store } });
  expect(wrapper.find('details').exists()).toBe(false);
  box.store.stop();
});
