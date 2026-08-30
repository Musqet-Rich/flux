import type { SessionSummary } from '@flux/protocol';
import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import SessionTabs from './SessionTabs.vue';

const s = (
  session: string,
  createdAt: string,
  state: SessionSummary['state'],
  lastSeq = 0,
): SessionSummary => ({
  session,
  title: `T ${session}`,
  repo: '/r',
  branch: 'b',
  harness: 'claude',
  state,
  lastSeq,
  createdAt,
  updatedAt: createdAt,
});

const titles = (wrapper: ReturnType<typeof mount>): string[] =>
  wrapper.findAll('button.tab:not(.add)').map((t) => t.find('.title').text());

test('orders by creation, marks the active one, and emits select and create', async () => {
  const sessions = [
    s('b', '2026-01-02T00:00:00Z', 'running'),
    s('a', '2026-01-01T00:00:00Z', 'idle'),
    s('c', '2026-01-02T00:00:00Z', 'idle'),
  ];
  const wrapper = mount(SessionTabs, { props: { sessions, active: 'a' } });
  const tabs = wrapper.findAll('button.tab:not(.add)');
  expect(titles(wrapper)).toEqual(['T a', 'T b', 'T c']);
  expect(tabs[0]?.classes()).toContain('active');
  expect(tabs[1]?.find('.dot').classes()).toContain('running');
  await tabs[1]?.trigger('click');
  expect(wrapper.emitted('select')).toEqual([['b']]);
  await wrapper.find('button.add').trigger('click');
  expect(wrapper.emitted('create')).toEqual([[]]);
});

test('a daemon that sends no createdAt still gets a stable order, by id', () => {
  const { createdAt, ...older } = s('b', '2026-01-01T00:00:00Z', 'idle');
  expect(createdAt).toBeTypeOf('string');
  const sessions = [
    older,
    s('a', '2026-01-02T00:00:00Z', 'idle'),
    s('c', '2026-01-03T00:00:00Z', 'idle'),
  ];
  const wrapper = mount(SessionTabs, { props: { sessions, active: 'a' } });
  expect(titles(wrapper)).toEqual(['T b', 'T a', 'T c']);
});

test('archived sessions get no tab', () => {
  const sessions = [
    s('a', '2026-01-01T00:00:00Z', 'idle'),
    { ...s('b', '2026-01-02T00:00:00Z', 'idle'), archived: true },
  ];
  const wrapper = mount(SessionTabs, { props: { sessions, active: 'a' } });
  expect(titles(wrapper)).toEqual(['T a']);
});

test('activity never reorders the tabs', async () => {
  const sessions = [s('a', '2026-01-01T00:00:00Z', 'idle'), s('b', '2026-01-02T00:00:00Z', 'idle')];
  const wrapper = mount(SessionTabs, { props: { sessions, active: 'a' } });
  await wrapper.setProps({
    sessions: [
      { ...s('a', '2026-01-01T00:00:00Z', 'idle', 3), updatedAt: '2026-03-01T00:00:00Z' },
      { ...s('b', '2026-01-02T00:00:00Z', 'running', 9), updatedAt: '2026-03-02T00:00:00Z' },
    ],
  });
  expect(titles(wrapper)).toEqual(['T a', 'T b']);
});

test('a background tab shows how many events arrived; selecting it clears the count', async () => {
  const wrapper = mount(SessionTabs, {
    props: {
      sessions: [
        s('a', '2026-01-01T00:00:00Z', 'idle', 4),
        s('b', '2026-01-02T00:00:00Z', 'idle', 4),
      ],
      active: 'a',
    },
  });
  expect(wrapper.findAll('.unread')).toHaveLength(0);
  await wrapper.setProps({
    sessions: [
      s('a', '2026-01-01T00:00:00Z', 'idle', 6),
      s('b', '2026-01-02T00:00:00Z', 'running', 7),
    ],
  });
  const badges = wrapper.findAll('button.tab:not(.add)').map((t) => t.find('.unread').exists());
  expect(badges).toEqual([false, true]);
  expect(wrapper.find('.unread').text()).toBe('3');
  await wrapper.setProps({ active: 'b' });
  expect(wrapper.findAll('.unread')).toHaveLength(0);
  await wrapper.setProps({
    sessions: [
      s('a', '2026-01-01T00:00:00Z', 'idle', 8),
      s('b', '2026-01-02T00:00:00Z', 'idle', 9),
    ],
  });
  expect(wrapper.findAll('button.tab:not(.add)')[0]?.find('.unread').text()).toBe('2');
});

test('a new session is appended and scrolls into view once selected', async () => {
  const scrolled: string[] = [];
  const record = (wrapper: ReturnType<typeof mount>): void => {
    for (const tab of wrapper.findAll('button.tab:not(.add)')) {
      tab.element.scrollIntoView = () => {
        scrolled.push(tab.find('.title').text());
      };
    }
  };
  const sessions = [s('a', '2026-01-01T00:00:00Z', 'idle'), s('b', '2026-01-02T00:00:00Z', 'idle')];
  const wrapper = mount(SessionTabs, { props: { sessions, active: 'a' } });
  record(wrapper);
  await wrapper.setProps({ sessions: [...sessions, s('c', '2026-01-03T00:00:00Z', 'idle')] });
  record(wrapper);
  expect(titles(wrapper)).toEqual(['T a', 'T b', 'T c']);
  expect(scrolled).toEqual([]);
  await wrapper.setProps({ active: 'c' });
  await flushPromises();
  expect(scrolled).toEqual(['T c']);
});
