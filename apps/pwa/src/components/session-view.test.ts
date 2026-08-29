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
