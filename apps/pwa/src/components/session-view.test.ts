import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import SessionView from './SessionView.vue';

const ref = { path: 'a.ts', rev: 'worktree', range: { startLine: 1, endLine: 1 } };

test('renders the log, streams, answers asks, sends with pending comments', async () => {
  const box = await pairedStore([], {
    'agent.send': () => ({ seq: 5 }),
    'agent.answer': () => ({}),
  });
  const { store, relay, event } = box;
  const wrapper = mount(SessionView, { props: { store, session: 's1' } });
  await until(() => store.state.logs['s1'] !== undefined);
  await relay.emit(event(1, 'msg.user', { text: 'hello' }));
  await relay.emit(event(2, 'comment.added', { commentId: 'c1', ref, text: 'nit' }));
  await relay.emit(
    event(3, 'ask', { askId: 'q', question: 'Go?', options: ['yes'], timeoutAt: 'x' }),
  );
  await until(() => store.state.logs['s1']?.lastSeq === 3);
  await relay.ephemeral({ type: 'delta', session: 's1', forSeq: 4, text: 'thinking' });
  await until(() => store.state.logs['s1']?.streaming === 'thinking');
  await flushPromises();
  expect(wrapper.findAll('.item').length).toBe(3);
  expect(wrapper.find('.streaming').text()).toBe('thinking');
  expect(wrapper.find('.branch').text()).toBe('flux/one');
  await wrapper.find('.ask .options button').trigger('click');
  await until(() => box.calls('agent.answer').length === 1);
  expect(box.calls('agent.answer')).toEqual([{ session: 's1', askId: 'q', answer: 'yes' }]);
  expect(wrapper.find('.tray .where').text()).toBe('a.ts:1');
  await wrapper.find('textarea').setValue('do it');
  await wrapper.find('form.row').trigger('submit');
  await until(() => box.calls('agent.send').length === 1);
  expect(box.calls('agent.send')).toEqual([{ session: 's1', text: 'do it', commentIds: ['c1'] }]);
  await until(() => Reflect.get(wrapper.vm, 'sending') === false);
  await flushPromises();
  expect(wrapper.find('textarea').element.value).toBe('');
  store.stop();
});

// Hooks and streaming envelopes arrive as `raw`, half a dozen around every reply, and the
// status bar is where rate limits live: neither belongs in the timeline, but both stay in the log.
test('raw and rate_limit events are kept in the log but not shown', async () => {
  const box = await pairedStore([]);
  const { store, relay, event } = box;
  const wrapper = mount(SessionView, { props: { store, session: 's1' } });
  await until(() => store.state.logs['s1'] !== undefined);
  await relay.emit(event(1, 'raw', { agent: 'claude', data: { type: 'system' } }));
  await relay.emit(event(2, 'msg.assistant', { text: 'hi' }));
  await relay.emit(event(3, 'rate_limit', { windows: [] }));
  await until(() => store.state.logs['s1']?.lastSeq === 3);
  await flushPromises();
  expect(store.state.logs['s1']?.events.length).toBe(3);
  expect(wrapper.findAll('.item').map((i) => i.text())).toEqual(['hi']);
  store.stop();
});

test('a failed action keeps the draft and surfaces the box error', async () => {
  const box = await pairedStore([]);
  const { store, relay, event } = box;
  const wrapper = mount(SessionView, { props: { store, session: 's1' } });
  await until(() => store.state.logs['s1'] !== undefined);
  await relay.emit(event(1, 'ask', { askId: 'q', question: 'Go?', timeoutAt: 'x' }));
  await until(() => store.state.logs['s1']?.lastSeq === 1);
  await flushPromises();
  await wrapper.find('.ask input').setValue('later');
  await wrapper.find('.ask form').trigger('submit');
  await until(() => store.state.error === 'no agent.answer');
  await wrapper.find('textarea').setValue('keep me');
  await wrapper.find('form.row').trigger('submit');
  await until(() => store.state.error === 'no agent.send');
  await until(() => Reflect.get(wrapper.vm, 'sending') === false);
  expect(wrapper.find('textarea').element.value).toBe('keep me');
  store.stop();
});

test('offers to stop a running agent and asks the box to interrupt', async () => {
  const box = await pairedStore([], { 'agent.interrupt': () => ({}) });
  const { store, relay, event } = box;
  const wrapper = mount(SessionView, { props: { store, session: 's1' } });
  expect(wrapper.findAll('.toolbar button').map((b) => b.text())).toEqual(['Changes']);
  await relay.emit(event(1, 'session.state', { state: 'running' }));
  await until(() => store.state.sessions[0]?.state === 'running');
  await flushPromises();
  await wrapper.find('.toolbar button').trigger('click');
  await until(() => box.calls('agent.interrupt').length === 1);
  expect(box.calls('agent.interrupt')).toEqual([{ session: 's1' }]);
  await wrapper.findAll('.toolbar button')[1]?.trigger('click');
  expect(wrapper.emitted('changes')).toEqual([[]]);
  store.stop();
});

// happy-dom has no layout, so the scroller's geometry is pinned by hand: a 1000 px log in a
// 200 px viewport, `scrollTop` writable so the component's jumps show up.
const withGeometry = (el: Element): HTMLElement => {
  Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 200, configurable: true });
  Object.defineProperty(el, 'scrollTop', { value: 800, writable: true, configurable: true });
  return el instanceof HTMLElement ? el : document.body;
};

const scrollTo = async (el: HTMLElement, top: number): Promise<void> => {
  el.scrollTop = top;
  el.dispatchEvent(new Event('scroll'));
  await flushPromises();
};

test('follows the tail only while at it, with a pill to catch up', async () => {
  const box = await pairedStore([], { 'agent.send': () => ({ seq: 9 }) });
  const { store, relay, event } = box;
  const wrapper = mount(SessionView, { props: { store, session: 's1' } });
  await until(() => store.state.logs['s1'] !== undefined);
  const el = withGeometry(wrapper.find('.timeline').element);
  await scrollTo(el, 800);
  await relay.emit(event(1, 'msg.assistant', { text: 'one' }));
  await until(() => store.state.logs['s1']?.lastSeq === 1);
  await flushPromises();
  expect(el.scrollTop).toBe(1000);
  expect(wrapper.find('.new-activity').exists()).toBe(false);
  await scrollTo(el, 0);
  await relay.emit(event(2, 'msg.assistant', { text: 'two' }));
  await relay.emit(event(3, 'raw', { agent: 'claude', data: {} }));
  await until(() => store.state.logs['s1']?.lastSeq === 3);
  await relay.ephemeral({ type: 'delta', session: 's1', forSeq: 4, text: 'more' });
  await until(() => store.state.logs['s1']?.streaming === 'more');
  await flushPromises();
  expect(el.scrollTop).toBe(0);
  expect(wrapper.find('.new-activity').text()).toBe('↓ 1 new');
  await wrapper.find('.new-activity').trigger('click');
  await flushPromises();
  expect(el.scrollTop).toBe(1000);
  expect(wrapper.find('.new-activity').exists()).toBe(false);
  await scrollTo(el, 0);
  await relay.emit(event(4, 'msg.assistant', { text: 'three' }));
  await until(() => store.state.logs['s1']?.lastSeq === 4);
  await flushPromises();
  expect(wrapper.find('.new-activity').text()).toBe('↓ 1 new');
  await scrollTo(el, 790);
  expect(wrapper.find('.new-activity').exists()).toBe(false);
  await scrollTo(el, 0);
  await wrapper.find('textarea').setValue('go');
  await wrapper.find('form.row').trigger('submit');
  await until(() => box.calls('agent.send').length === 1);
  await flushPromises();
  expect(el.scrollTop).toBe(1000);
  store.stop();
});
