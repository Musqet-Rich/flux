import type { SessionSummary } from '@flux/protocol';
import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { escapeStack } from './escape-stack.ts';
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
  const wrapper = mount(SessionTabs, { props: { sessions, active: 'a', chord: 'ctrlAlt' } });
  const tabs = wrapper.findAll('button.tab:not(.add)');
  expect(titles(wrapper)).toEqual(['T a', 'T b', 'T c']);
  expect(tabs[0]?.classes()).toContain('active');
  expect(tabs[1]?.find('.dot').classes()).toContain('running');
  await tabs[1]?.trigger('click');
  expect(wrapper.emitted('select')).toEqual([['b']]);
  await wrapper.find('button.add').trigger('click');
  expect(wrapper.emitted('create')).toEqual([[]]);
  wrapper.unmount();
});

test('a daemon that sends no createdAt still gets a stable order, by id', () => {
  const { createdAt, ...older } = s('b', '2026-01-01T00:00:00Z', 'idle');
  expect(createdAt).toBeTypeOf('string');
  const sessions = [
    older,
    s('a', '2026-01-02T00:00:00Z', 'idle'),
    s('c', '2026-01-03T00:00:00Z', 'idle'),
  ];
  const wrapper = mount(SessionTabs, { props: { sessions, active: 'a', chord: 'ctrlAlt' } });
  expect(titles(wrapper)).toEqual(['T b', 'T a', 'T c']);
  wrapper.unmount();
});

test('archived sessions get no tab', () => {
  const sessions = [
    s('a', '2026-01-01T00:00:00Z', 'idle'),
    { ...s('b', '2026-01-02T00:00:00Z', 'idle'), archived: true },
  ];
  const wrapper = mount(SessionTabs, { props: { sessions, active: 'a', chord: 'ctrlAlt' } });
  expect(titles(wrapper)).toEqual(['T a']);
  wrapper.unmount();
});

test('activity never reorders the tabs', async () => {
  const sessions = [s('a', '2026-01-01T00:00:00Z', 'idle'), s('b', '2026-01-02T00:00:00Z', 'idle')];
  const wrapper = mount(SessionTabs, { props: { sessions, active: 'a', chord: 'ctrlAlt' } });
  await wrapper.setProps({
    sessions: [
      { ...s('a', '2026-01-01T00:00:00Z', 'idle', 3), updatedAt: '2026-03-01T00:00:00Z' },
      { ...s('b', '2026-01-02T00:00:00Z', 'running', 9), updatedAt: '2026-03-02T00:00:00Z' },
    ],
  });
  expect(titles(wrapper)).toEqual(['T a', 'T b']);
  wrapper.unmount();
});

test('a background tab shows how many events arrived; selecting it clears the count', async () => {
  const wrapper = mount(SessionTabs, {
    props: {
      sessions: [
        s('a', '2026-01-01T00:00:00Z', 'idle', 4),
        s('b', '2026-01-02T00:00:00Z', 'idle', 4),
      ],
      active: 'a',
      chord: 'ctrlAlt',
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
  wrapper.unmount();
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
  const wrapper = mount(SessionTabs, { props: { sessions, active: 'a', chord: 'ctrlAlt' } });
  record(wrapper);
  await wrapper.setProps({ sessions: [...sessions, s('c', '2026-01-03T00:00:00Z', 'idle')] });
  record(wrapper);
  expect(titles(wrapper)).toEqual(['T a', 'T b', 'T c']);
  expect(scrolled).toEqual([]);
  await wrapper.setProps({ active: 'c' });
  await flushPromises();
  expect(scrolled).toEqual(['T c']);
  wrapper.unmount();
});

// Stands in for a modal or sheet open on top of the screen.
const onTop = (): void => {};

const press = (key: string, init: KeyboardEventInit = {}): KeyboardEvent =>
  new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });

test('the switch chord steps along the tabs, wrapping, and lands on an end from no tab', async () => {
  const sessions = [
    s('a', '2026-01-01T00:00:00Z', 'idle'),
    { ...s('x', '2026-01-01T12:00:00Z', 'idle'), archived: true },
    s('b', '2026-01-02T00:00:00Z', 'idle'),
    s('c', '2026-01-03T00:00:00Z', 'idle'),
  ];
  const wrapper = mount(SessionTabs, {
    props: { sessions, active: 'c', chord: 'ctrlAlt' },
    attachTo: document.body,
  });
  const right = press('ArrowRight', { ctrlKey: true, altKey: true });
  window.dispatchEvent(right);
  expect(right.defaultPrevented).toBe(true);
  await wrapper.setProps({ active: 'a' });
  window.dispatchEvent(press('ArrowLeft', { ctrlKey: true, altKey: true }));
  await wrapper.setProps({ active: null });
  window.dispatchEvent(press('ArrowRight', { ctrlKey: true, altKey: true }));
  window.dispatchEvent(press('ArrowLeft', { ctrlKey: true, altKey: true }));
  expect(wrapper.emitted('select')).toEqual([['a'], ['c'], ['a'], ['c']]);
  wrapper.unmount();
  const after = press('ArrowRight', { ctrlKey: true, altKey: true });
  window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
});

test('a lone tab, a wrong chord, something open on top, a repeat and Off select nothing', async () => {
  const sessions = [s('a', '2026-01-01T00:00:00Z', 'idle')];
  const wrapper = mount(SessionTabs, {
    props: { sessions, active: 'a', chord: 'ctrlAlt' },
    attachTo: document.body,
  });
  const lone = press('ArrowRight', { ctrlKey: true, altKey: true });
  window.dispatchEvent(lone);
  expect(lone.defaultPrevented).toBe(false);
  await wrapper.setProps({ sessions: [...sessions, s('b', '2026-01-02T00:00:00Z', 'idle')] });
  escapeStack.register(onTop);
  const under = press('ArrowRight', { ctrlKey: true, altKey: true });
  window.dispatchEvent(under);
  escapeStack.unregister(onTop);
  expect(under.defaultPrevented).toBe(false);
  // A held key's repeats are kept from the browser, which would walk Back, but switch nothing.
  const repeat = press('ArrowRight', { ctrlKey: true, altKey: true, repeat: true });
  window.dispatchEvent(repeat);
  expect(repeat.defaultPrevented).toBe(true);
  await wrapper.setProps({ sessions });
  const wrong = press('ArrowRight', { altKey: true });
  window.dispatchEvent(wrong);
  expect(wrong.defaultPrevented).toBe(false);
  await wrapper.setProps({ chord: 'off' });
  const off = press('ArrowRight', { ctrlKey: true, altKey: true });
  window.dispatchEvent(off);
  expect(off.defaultPrevented).toBe(false);
  expect(wrapper.emitted('select')).toBeUndefined();
  wrapper.unmount();
});
