import type { SessionSummary } from '@flux/protocol';
import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import SessionTabs from './SessionTabs.vue';

const s = (session: string, updatedAt: string, state: SessionSummary['state']): SessionSummary => ({
  session,
  title: `T ${session}`,
  repo: '/r',
  branch: 'b',
  agent: 'claude',
  state,
  lastSeq: 0,
  updatedAt,
});

test('lists sessions newest first, marks the active one, and emits select and create', async () => {
  const sessions = [
    s('a', '2026-01-01T00:00:00Z', 'idle'),
    s('b', '2026-01-02T00:00:00Z', 'running'),
  ];
  const wrapper = mount(SessionTabs, { props: { sessions, active: 'a' } });
  const tabs = wrapper.findAll('button.tab:not(.add)');
  expect(tabs.map((t) => t.text())).toEqual(['T b', 'T a']);
  expect(tabs[1]?.classes()).toContain('active');
  expect(tabs[0]?.find('.dot').classes()).toContain('running');
  await tabs[0]?.trigger('click');
  expect(wrapper.emitted('select')).toEqual([['b']]);
  await wrapper.find('button.add').trigger('click');
  expect(wrapper.emitted('create')).toEqual([[]]);
});
