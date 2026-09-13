import type { EventPayloads, EventType, FluxEvent } from '@flux/protocol';
import type { VueWrapper } from '@vue/test-utils';
import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import { fakeScroller } from '../../test/fake-scroller.ts';
import SessionTimeline from './SessionTimeline.vue';

// The timeline draws its rows with each past run of tool calls behind a disclosure
// (fold-tool-runs.ts decides the runs): one line counting the calls, the rows inside once
// opened, and the run still being written flat. The scroller's geometry is pinned
// (test/fake-scroller): at the tail at 800, scrolled up at 0.

let seq = 0;
const ev = <T extends EventType>(type: T, payload: EventPayloads[T]): FluxEvent => ({
  seq: (seq += 1),
  ts: '2026-01-01T00:00:00Z',
  session: 's1',
  type,
  payload,
});
const call = (ok: boolean): FluxEvent[] => [
  ev('tool.start', { toolId: 't', name: 'Bash', input: { c: 'ls' }, summary: 'Bash: ls' }),
  ev('tool.end', { toolId: 't', ok, summary: ok ? 'Bash ok' : 'Bash failed', output: 'x' }),
];

const mountTimeline = (rows: FluxEvent[]): VueWrapper<InstanceType<typeof SessionTimeline>> =>
  mount(SessionTimeline, {
    props: {
      rows,
      earlier: 0,
      quoteOf: () => null,
      thumbs: {},
      onMain: true,
      streaming: '',
      thinking: null,
      compacting: false,
      ask: null,
    },
  });

test('past tool calls sit behind one line; the trailing run stays flat', async () => {
  const rows = [
    ev('msg.assistant', { text: 'Looking.' }),
    ...call(true),
    ...call(false),
    ev('msg.assistant', { text: 'Found it.' }),
    ...call(true),
    ...call(true),
  ];
  const wrapper = mountTimeline(rows);
  const folds = wrapper.findAll('details.fold');
  expect(folds).toHaveLength(1);
  const [fold] = folds;
  expect(fold?.find('summary').text()).toBe('2 tool calls, 1 failed');
  expect(fold?.classes()).toContain('error');
  expect(fold?.findAll('.item.tool').map((item) => item.text())).toEqual([
    'Bash: ls',
    'Bash ok',
    'Bash: ls',
    'Bash failed',
  ]);
  // Only the trailing run's rows are the timeline's own children.
  const flat = wrapper.findAll('.timeline > .item');
  expect(flat.map((item) => item.classes().includes('tool'))).toEqual([
    false,
    false,
    true,
    true,
    true,
    true,
  ]);
  // The rows in a fold keep their own tap: the detail opens inside it.
  expect(fold?.find('.detail').exists()).toBe(false);
  await fold?.find('.item.tool .summary').trigger('click');
  expect(fold?.find('.detail').text()).toContain('"c": "ls"');
});

// The trailing run folds when the next row lands and the operator is at the tail, and is held
// flat while they are scrolled up into it, until they reach the tail again.
const trailing = (): FluxEvent[] => [
  ev('msg.assistant', { text: 'Looking.' }),
  ...call(true),
  ...call(true),
];
const landed = (): FluxEvent => ev('msg.assistant', { text: 'Found it.' });

test('at the tail, the next row folds the run and the window is trimmed', async () => {
  const rows = trailing();
  const wrapper = mountTimeline(rows);
  fakeScroller.pin(wrapper.find<HTMLElement>('.timeline').element);
  await wrapper.setProps({ rows: [...rows, landed()] });
  await flushPromises();
  expect(wrapper.findAll('details.fold')).toHaveLength(1);
  expect(wrapper.emitted('trim')).toHaveLength(1);
});

test('scrolled up into the run, it stays flat with its open detail until the tail is reached', async () => {
  const rows = trailing();
  const wrapper = mountTimeline(rows);
  const el = fakeScroller.pin(wrapper.find<HTMLElement>('.timeline').element);
  await fakeScroller.scrollTo(el, 0);
  await wrapper.findAll('.item.tool .summary')[2]?.trigger('click');
  expect(wrapper.findAll('.item.tool .detail')).toHaveLength(1);
  const next = [...rows, landed()];
  await wrapper.setProps({ rows: next });
  await flushPromises();
  expect(wrapper.findAll('details.fold')).toHaveLength(0);
  expect(wrapper.findAll('.item.tool .detail')).toHaveLength(1);
  expect(wrapper.find('.new-activity').text()).toBe('1 new');
  expect(wrapper.emitted('trim')).toBeUndefined();
  // More rows while still scrolled up are held too, whatever follows them.
  await wrapper.setProps({ rows: [...next, ...call(false), ...call(true), landed()] });
  await flushPromises();
  expect(wrapper.findAll('details.fold')).toHaveLength(0);
  expect(wrapper.find('.new-activity').text()).toBe('6 new');
  // The pill, a send or an answer jumps to the tail: that lifts the hold too.
  await wrapper.vm.jump();
  await flushPromises();
  expect(wrapper.findAll('details.fold').map((fold) => fold.find('summary').text())).toEqual([
    '2 tool calls',
    '2 tool calls, 1 failed',
  ]);
  expect(wrapper.find('.new-activity').exists()).toBe(false);
  expect(el.scrollTop).toBe(1000);
});

// A clear landing while scrolled up takes the operator to it (ADR 0034): the parent's window
// opens at the marker, so the rows' top moves forward; that is a jump, not a "new" pill, and
// the hold lifts with it.
test('a clear landing while scrolled up jumps to the marker with no pill', async () => {
  const rows = trailing();
  const wrapper = mountTimeline(rows);
  const el = fakeScroller.pin(wrapper.find<HTMLElement>('.timeline').element);
  await fakeScroller.scrollTo(el, 0);
  await wrapper.setProps({ rows: [ev('session.cleared', {}), landed()] });
  await flushPromises();
  expect(wrapper.find('.new-activity').exists()).toBe(false);
  expect(wrapper.emitted('trim')).toBeUndefined();
  expect(el.scrollTop).toBe(1000);
  expect(wrapper.findAll('.item').length).toBeGreaterThan(0);
});

test('an open fold stays open, and the same element, across a trim and Show earlier', async () => {
  const rows = [...trailing(), landed(), ...call(true), ...call(true), landed()];
  const wrapper = mountTimeline(rows);
  const fold = wrapper.find<HTMLDetailsElement>('details.fold');
  fold.element.open = true;
  // A trim cuts the window's top rows; Show earlier brings them back.
  await wrapper.setProps({ rows: rows.slice(2) });
  expect(wrapper.find<HTMLDetailsElement>('details.fold').element).toBe(fold.element);
  await wrapper.setProps({ rows });
  expect(wrapper.find<HTMLDetailsElement>('details.fold').element).toBe(fold.element);
  expect(fold.element.open).toBe(true);
});
