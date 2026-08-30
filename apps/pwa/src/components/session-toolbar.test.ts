import type { SessionSummary } from '@flux/protocol';
import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import SessionToolbar from './SessionToolbar.vue';

const base: SessionSummary = {
  session: 's1',
  title: 'First',
  repo: '/repos/r',
  branch: 'flux/one',
  harness: 'claude',
  state: 'idle',
  lastSeq: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const toolbar = async (summary: SessionSummary | null) => {
  const box = await pairedStore();
  box.store.state.sessions = summary === null ? [] : [summary];
  const wrapper = mount(SessionToolbar, {
    props: { store: box.store, session: 's1', events: [], branch: 'flux/one', busy: false },
  });
  return { box, wrapper };
};

test('the chip shows harness, model and effort, dropping the segments the box did not set', async () => {
  const { box, wrapper } = await toolbar({ ...base, model: 'opus', effort: 'high' });
  expect(wrapper.find('.spec-chip').text()).toBe('Claude Code · opus · high');
  box.store.stop();
});

test('the chip shows the harness alone when model and effort are unset', async () => {
  const { box, wrapper } = await toolbar(base);
  expect(wrapper.find('.spec-chip').text()).toBe('Claude Code');
  box.store.stop();
});

test('the chip keeps the set segments and labels pi', async () => {
  const { box, wrapper } = await toolbar({ ...base, harness: 'pi', model: 'sonnet' });
  expect(wrapper.find('.spec-chip').text()).toBe('Pi · sonnet');
  box.store.stop();
});

test('no chip is shown when the session is not in the list', async () => {
  const { box, wrapper } = await toolbar(null);
  expect(wrapper.find('.spec-chip').exists()).toBe(false);
  box.store.stop();
});
