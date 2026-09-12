import type { FluxEvent } from '@flux/protocol';
import { flushPromises, mount } from '@vue/test-utils';
import { expect, test, vi } from 'vitest';

import { fakeScroller } from '../../test/fake-scroller.ts';
import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import SessionView from './SessionView.vue';

// The window of rows a chat keeps in the DOM (useSessionTimeline): a long session renders its
// last 300, sliding with new rows while the operator is at the tail and holding while they are
// scrolled up, with Show earlier and a reply chip widening it.

const { pin, scrollTo } = fakeScroller;
const ts = '2026-01-01T00:00:00Z';

const rows = (from: number, to: number, parent?: string): FluxEvent[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    seq: from + i,
    ts,
    session: 's1',
    type: 'msg.assistant',
    payload: { text: `row ${from + i}` },
    ...(parent === undefined ? {} : { parent }),
  }));

const shown = (wrapper: ReturnType<typeof mount>): [number, string] => [
  wrapper.findAll('.item').length,
  wrapper.find('.item').text(),
];

test('main keeps its last 300 rows: sliding at the tail, held while scrolled up', async () => {
  const box = await pairedStore(rows(1, 320));
  const { store, relay, event } = box;
  const wrapper = mount(SessionView, { props: { store, session: 's1' } });
  await until(() => store.state.logs['s1']?.lastSeq === 320);
  await flushPromises();
  expect(shown(wrapper)).toEqual([300, 'row 21']);
  expect(wrapper.find('.earlier').text()).toBe('Show 20 earlier');
  // At the tail, a new row slides the window: the oldest leaves as the newest lands.
  const el = pin(wrapper.find<HTMLElement>('.timeline').element);
  await scrollTo(el, 800);
  await relay.emit(event(321, 'msg.assistant', { text: 'row 321' }));
  await until(() => store.state.logs['s1']?.lastSeq === 321);
  await flushPromises();
  expect(shown(wrapper)).toEqual([300, 'row 22']);
  expect(el.scrollTop).toBe(1000);
  // Scrolled up, the window holds its top edge: the row being read stays, the new one is
  // counted on the pill, and catching up cuts the window back to size.
  await scrollTo(el, 0);
  await relay.emit(event(322, 'msg.assistant', { text: 'row 322' }));
  await until(() => store.state.logs['s1']?.lastSeq === 322);
  await flushPromises();
  expect(shown(wrapper)).toEqual([301, 'row 22']);
  expect(wrapper.find('.new-activity').text()).toBe('↓ 1 new');
  await wrapper.find('.new-activity').trigger('click');
  await flushPromises();
  expect(shown(wrapper)).toEqual([300, 'row 23']);
  expect(el.scrollTop).toBe(1000);
  // Show earlier brings in up to 200 more; here that is all of them.
  await scrollTo(el, 0);
  await wrapper.find('.earlier').trigger('click');
  await flushPromises();
  expect(shown(wrapper)).toEqual([322, 'row 1']);
  expect(wrapper.find('.earlier').exists()).toBe(false);
  expect(wrapper.find('.new-activity').exists()).toBe(false);
  store.stop();
});

test('a reply chip widens the window to the message it quotes before scrolling to it', async () => {
  const events = rows(1, 309);
  events.push({
    seq: 310,
    ts,
    session: 's1',
    type: 'msg.user',
    payload: { text: 'B', replyTo: 1 },
  });
  const box = await pairedStore(events);
  const { store } = box;
  const wrapper = mount(SessionView, { props: { store, session: 's1' } });
  await until(() => store.state.logs['s1']?.lastSeq === 310);
  await flushPromises();
  expect(shown(wrapper)).toEqual([300, 'row 11']);
  expect(wrapper.find('[data-seq="1"]').exists()).toBe(false);
  // happy-dom's scrollIntoView is a no-op; the spy's contexts say which row was scrolled to.
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
  await wrapper.find('.user .quote').trigger('click');
  await flushPromises();
  expect(wrapper.find('[data-seq="1"]').text()).toBe('row 1');
  expect(shown(wrapper)).toEqual([310, 'row 1']);
  const targets: unknown[] = scroll.mock.contexts;
  expect(targets).toEqual([wrapper.find('[data-seq="1"]').element]);
  scroll.mockRestore();
  store.stop();
});

const started = (taskId: string, toolUseId: string, description: string): unknown => ({
  taskId,
  toolUseId,
  description,
  agentType: 'Explore',
  background: false,
});

// Hundreds of rows per task is normal; the last 300 render and a button brings the rest.
test('a long subagent chat shows its last 300 rows until asked for earlier ones', async () => {
  const events: FluxEvent[] = [
    { seq: 1, ts, session: 's1', type: 'task.started', payload: started('t1', 'u1', 'Long') },
    ...rows(2, 352, 'u1'),
  ];
  const box = await pairedStore(events);
  const { store } = box;
  const wrapper = mount(SessionView, { props: { store, session: 's1' } });
  await until(() => store.state.logs['s1']?.lastSeq === 352);
  await flushPromises();
  await wrapper.findAll('.agents .row')[1]?.trigger('click');
  await flushPromises();
  expect(shown(wrapper)).toEqual([300, 'row 53']);
  expect(wrapper.find('.earlier').text()).toBe('Show 51 earlier');
  // The operator is at the top to press it; the rows it brings in are old, not new activity.
  const el = pin(wrapper.find<HTMLElement>('.timeline').element);
  await scrollTo(el, 0);
  await wrapper.find('.earlier').trigger('click');
  await flushPromises();
  expect(shown(wrapper)).toEqual([351, 'row 2']);
  expect(wrapper.find('.earlier').exists()).toBe(false);
  expect(wrapper.find('.new-activity').exists()).toBe(false);
  expect(el.scrollTop).toBe(0);
  store.stop();
});
