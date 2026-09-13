import { mount } from '@vue/test-utils';
import { afterEach, expect, test, vi } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import { createMemoryStorage } from '../client/create-memory-storage.ts';
import type { Route } from '../router/create-router.ts';
import { splitAt } from '../store/split-at.ts';
import SessionScreens from './SessionScreens.vue';

// The split on a wide screen (ADR 0033): the chat stays beside a pane holding the panel routes,
// the chat route alone closes it, and the divider is dragged and kept. The views are stubbed:
// this is about the layout and what the route puts where.

const stubs = {
  SessionView: true,
  ChangesView: true,
  FilesView: true,
  DiffView: true,
  EditView: true,
};

const right = 'ArrowRight';
const left = 'ArrowLeft';

// The media query, with a way to resize the window across the line.
const wideScreen = (matches: boolean) => {
  const listeners: ((event: MediaQueryListEvent) => void)[] = [];
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.push(listener);
    },
    removeEventListener: () => {},
  } as unknown as MediaQueryList);
  return (to: boolean): void => {
    for (const listener of listeners) listener({ matches: to } as MediaQueryListEvent);
  };
};
// happy-dom draws nothing and captures no pointer; the row is a thousand pixels wide from zero.
const layOut = (): void => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    width: 1000,
  } as DOMRect);
  HTMLElement.prototype.setPointerCapture = () => {};
};

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
});

type SessionRoute = Extract<Route, { session: string }>;

const screens = async (route: SessionRoute, storage = createMemoryStorage()) => {
  const box = await pairedStore([], {}, { storage });
  const wrapper = mount(SessionScreens, {
    props: { store: box.store, route },
    global: { stubs },
  });
  return { box, wrapper, storage };
};

test('a narrow screen shows one screen at a time, the panel without its strip', async () => {
  wideScreen(false);
  const { box, wrapper } = await screens({ name: 'changes', session: 's1' });
  expect(wrapper.find('.split').exists()).toBe(false);
  expect(wrapper.findComponent({ name: 'SessionView' }).exists()).toBe(false);
  expect(wrapper.find('nav.tabs').exists()).toBe(false);
  expect(wrapper.findComponent({ name: 'ChangesView' }).props('paned')).toBe(false);
  await wrapper.setProps({ route: { name: 'session', session: 's1' } });
  expect(wrapper.findComponent({ name: 'SessionView' }).exists()).toBe(true);
  expect(wrapper.findComponent({ name: 'ChangesView' }).exists()).toBe(false);
  box.store.stop();
});

test('a wide screen keeps the one chat beside the pane, the strip lit by the route, close going back', async () => {
  const resize = wideScreen(true);
  const { box, wrapper } = await screens({ name: 'session', session: 's1' });
  expect(wrapper.find('.split').exists()).toBe(false);
  const chat = wrapper.findComponent({ name: 'SessionView' }).vm;
  await wrapper.setProps({ route: { name: 'changes', session: 's1' } });
  expect(wrapper.find('.split').exists()).toBe(true);
  // The same chat, not a fresh one: its scroll and draft are kept while the pane comes and goes.
  expect(wrapper.findComponent({ name: 'SessionView' }).vm).toBe(chat);
  expect(wrapper.findComponent({ name: 'ChangesView' }).props('paned')).toBe(true);
  const lit = () =>
    wrapper.findAll('.tab').map((t) => `${t.text()}:${String(t.attributes('aria-current'))}`);
  expect(lit()).toEqual(['Changes:page', 'Files:undefined']);
  await wrapper.setProps({ route: { name: 'diff', session: 's1', path: 'a.ts' } });
  expect(lit()).toEqual(['Changes:page', 'Files:undefined']);
  await wrapper.setProps({ route: { name: 'edit', session: 's1', path: 'a.ts', dir: 'src' } });
  expect(lit()).toEqual(['Changes:undefined', 'Files:page']);
  await wrapper.setProps({ route: { name: 'edit', session: 's1', path: 'a.ts' } });
  expect(lit()).toEqual(['Changes:page', 'Files:undefined']);
  await wrapper.findAll('.tab')[1]?.trigger('click');
  await wrapper.find('[aria-label="Close pane"]').trigger('click');
  expect(wrapper.emitted('go')).toEqual([
    [{ name: 'files', session: 's1', path: '' }],
    [{ name: 'session', session: 's1' }],
  ]);
  await wrapper.setProps({ route: { name: 'session', session: 's1' } });
  expect(wrapper.findComponent({ name: 'SessionView' }).vm).toBe(chat);
  // The window narrowed across the line on the chat: the same chat still, the layout plain.
  resize(false);
  await wrapper.vm.$nextTick();
  expect(wrapper.findComponent({ name: 'SessionView' }).vm).toBe(chat);
  await wrapper.setProps({ route: { name: 'changes', session: 's1' } });
  expect(wrapper.find('.split').exists()).toBe(false);
  expect(wrapper.findComponent({ name: 'SessionView' }).exists()).toBe(false);
  resize(true);
  await wrapper.vm.$nextTick();
  expect(wrapper.find('.split').exists()).toBe(true);
  box.store.stop();
});

test('the divider sizes the chat live, keeps the place when let go, and steps by keyboard', async () => {
  wideScreen(true);
  layOut();
  const { box, wrapper, storage } = await screens({ name: 'changes', session: 's1' });
  const chat = wrapper.find('.chat');
  const divider = wrapper.find('[role="separator"]');
  expect(chat.attributes('style')).toContain('--share: 0.5;');
  expect(divider.attributes('aria-valuenow')).toBe('50');
  // A right button, or a move with no drag on, does nothing.
  await divider.trigger('pointerdown', { button: 2, pointerId: 1, clientX: 500 });
  await divider.trigger('pointermove', { pointerId: 1, clientX: 400 });
  expect(chat.attributes('style')).toContain('--share: 0.5;');
  await divider.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 500 });
  await divider.trigger('pointermove', { pointerId: 1, clientX: 400 });
  expect(chat.attributes('style')).toContain('--share: 0.4;');
  expect(divider.attributes('aria-valuenow')).toBe('40');
  expect(divider.classes()).toContain('dragging');
  expect(box.store.state.splitAt).toBe(0.5);
  // A second finger while the first drags is not the drag.
  await divider.trigger('pointerdown', { button: 0, pointerId: 2, clientX: 900 });
  await divider.trigger('pointermove', { pointerId: 2, clientX: 900 });
  await divider.trigger('pointerup', { pointerId: 2 });
  expect(chat.attributes('style')).toContain('--share: 0.4;');
  expect(divider.classes()).toContain('dragging');
  await divider.trigger('pointermove', { pointerId: 1, clientX: 950 });
  expect(chat.attributes('style')).toContain('--share: 0.7;');
  await divider.trigger('pointermove', { pointerId: 1, clientX: 50 });
  expect(chat.attributes('style')).toContain('--share: 0.3;');
  await divider.trigger('pointerup', { pointerId: 1 });
  expect(divider.classes()).not.toContain('dragging');
  await until(() => box.store.state.splitAt === 0.3);
  expect(await storage.get(splitAt.storageKey)).toBe(0.3);
  // Let go: a move no longer resizes; a press with no move keeps nothing.
  await divider.trigger('pointermove', { pointerId: 1, clientX: 600 });
  expect(chat.attributes('style')).toContain('--share: 0.3;');
  await divider.trigger('pointerdown', { button: 0, pointerId: 3, clientX: 300 });
  await divider.trigger('pointercancel', { pointerId: 3 });
  expect(divider.classes()).not.toContain('dragging');
  box.store.stop();
});

test('the keyboard steps the divider, a held key kept once when let go', async () => {
  wideScreen(true);
  const { box, wrapper } = await screens({ name: 'changes', session: 's1' });
  const chat = wrapper.find('.chat');
  const divider = wrapper.find('[role="separator"]');
  await divider.trigger('keydown', { key: right });
  await divider.trigger('keydown', { key: right });
  expect(chat.attributes('style')).toContain('--share: 0.54;');
  expect(box.store.state.splitAt).toBe(0.5);
  await divider.trigger('keyup', { key: right });
  await until(() => box.store.state.splitAt === 0.54);
  await divider.trigger('keydown', { key: left });
  await divider.trigger('keydown', { key: left });
  await divider.trigger('keydown', { key: left });
  await divider.trigger('keyup', { key: left });
  await until(() => box.store.state.splitAt === 0.48);
  expect(chat.attributes('style')).toContain('--share: 0.48;');
  await divider.trigger('keydown', { key: 'a' });
  await divider.trigger('keyup', { key: 'a' });
  expect(chat.attributes('style')).toContain('--share: 0.48;');
  box.store.stop();
});
