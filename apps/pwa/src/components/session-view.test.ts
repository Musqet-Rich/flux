import type { FluxEvent } from '@flux/protocol';
import type { DOMWrapper, VueWrapper } from '@vue/test-utils';
import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import type { PairedStore } from '../../test/paired-store.ts';
import { pairedStore } from '../../test/paired-store.ts';
import { until } from '../../test/until.ts';
import Composer from './Composer.vue';
import SessionView from './SessionView.vue';

// The rows of the agents strip as read: glyph, type and description with a space between.
const stripRows = (wrapper: VueWrapper): string[] =>
  wrapper.findAll('.agents .row').map((r) =>
    r
      .findAll('span')
      .map((span) => span.text())
      .filter((text) => text !== '')
      .join(' '),
  );

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
  await until(() => Reflect.get(wrapper.findComponent(Composer).vm, 'sending') === false);
  await flushPromises();
  expect(wrapper.find('textarea').element.value).toBe('');
  store.stop();
});

// Hooks and streaming envelopes arrive as `raw`, half a dozen around every reply; rate limits
// live in the status bar; a subagent repeats `files.changed` on every write, and its count rides
// the Changes button. None belong in the timeline, but all stay in the log.
test('raw, rate_limit and files.changed are kept in the log but not shown', async () => {
  const box = await pairedStore([]);
  const { store, relay, event } = box;
  const wrapper = mount(SessionView, { props: { store, session: 's1' } });
  await until(() => store.state.logs['s1'] !== undefined);
  await relay.emit(event(1, 'raw', { agent: 'claude', data: { type: 'system' } }));
  await relay.emit(event(2, 'msg.assistant', { text: 'hi' }));
  await relay.emit(event(3, 'rate_limit', { windows: [] }));
  await relay.emit(event(4, 'files.changed', { files: [{ path: 'a.ts', status: 'M' }] }));
  await until(() => store.state.logs['s1']?.lastSeq === 4);
  await flushPromises();
  expect(store.state.logs['s1']?.events.length).toBe(4);
  expect(wrapper.findAll('.item').map((i) => i.text())).toEqual(['hi']);
  expect(wrapper.findAll('.toolbar button').map((b) => b.text())).toContain('Changes (1)');
  store.stop();
});

const pr = {
  provider: 'github',
  url: 'https://github.com/o/r/pull/19',
  repo: 'o/r',
  identifier: '19',
  action: 'created',
};

// A long think used to look like a hang; now the streaming bubble says so, with Claude's token
// estimate once it arrives, and the reply's first text takes its place.
test('shows the thinking indicator until text streams, and the PR link once one is published', async () => {
  const box = await pairedStore([]);
  const { store, relay, event } = box;
  const wrapper = mount(SessionView, { props: { store, session: 's1' } });
  await until(() => store.state.logs['s1'] !== undefined);
  expect(wrapper.find('.streaming').exists()).toBe(false);
  await relay.ephemeral({ type: 'agent.thinking', session: 's1', active: true });
  await until(() => store.state.logs['s1']?.thinking !== null);
  await flushPromises();
  expect(wrapper.find('.streaming .thinking').text()).toBe('Thinking…');
  // The chosen spinner sits before the text while thinking.
  expect(wrapper.find('.streaming .thinking .loader').exists()).toBe(true);
  await relay.ephemeral({
    type: 'agent.thinking',
    session: 's1',
    active: true,
    estimatedTokens: 1250,
  });
  await until(() => store.state.logs['s1']?.thinking?.estimatedTokens === 1250);
  await flushPromises();
  expect(wrapper.find('.streaming .thinking').text()).toBe('Thinking… ~1.3k tokens');
  await relay.ephemeral({ type: 'delta', session: 's1', forSeq: 1, text: 'Here' });
  await until(() => store.state.logs['s1']?.streaming === 'Here');
  await flushPromises();
  expect(wrapper.find('.streaming .thinking').exists()).toBe(false);
  // The spinner goes with the indicator once the reply's text arrives.
  expect(wrapper.find('.loader').exists()).toBe(false);
  expect(wrapper.find('.streaming').text()).toBe('Here');
  expect(wrapper.find('.toolbar .pr').exists()).toBe(false);
  await relay.emit(event(1, 'pr.published', pr));
  await until(() => store.state.logs['s1']?.lastSeq === 1);
  await flushPromises();
  const link = wrapper.find('.toolbar .pr');
  expect(link.text()).toBe('PR #19');
  expect(link.attributes()).toMatchObject({ href: pr.url, rel: 'noopener noreferrer' });
  expect(wrapper.find('.timeline a.link').text()).toBe('Pull request #19 created · o/r');
  store.stop();
});

// The compaction is a ~59s black box, so a running /compact turn draws an indeterminate
// indicator until the boundary lands, which then rules across the timeline with the token delta.
test('shows a Compacting indicator while a /compact turn runs, gone after the boundary', async () => {
  const box = await pairedStore([]);
  const { store, relay, event } = box;
  const wrapper = mount(SessionView, { props: { store, session: 's1' } });
  await until(() => store.state.logs['s1'] !== undefined);
  await relay.emit(event(1, 'session.state', { state: 'running' }));
  await until(() => store.state.sessions[0]?.state === 'running');
  await flushPromises();
  // Running, but no /compact turn yet: no indicator.
  expect(wrapper.find('.compacting').exists()).toBe(false);
  await relay.emit(event(2, 'msg.user', { text: '/compact' }));
  await until(() => store.state.logs['s1']?.lastSeq === 2);
  await flushPromises();
  expect(wrapper.find('.compacting').text()).toBe('Compacting…');
  expect(wrapper.find('.compacting .loader').exists()).toBe(true);
  await relay.emit(
    event(3, 'compact.boundary', {
      trigger: 'manual',
      preTokens: 60065,
      postTokens: 6202,
      durationMs: 59369,
      result: 'success',
    }),
  );
  await until(() => store.state.logs['s1']?.lastSeq === 3);
  await flushPromises();
  expect(wrapper.find('.compacting').exists()).toBe(false);
  expect(wrapper.find('.timeline .rule').text()).toBe(
    'Context compacted · 60k → 6.2k tokens · 59s',
  );
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
  await until(() => store.state.error?.message === 'no agent.answer');
  await wrapper.find('textarea').setValue('keep me');
  await wrapper.find('form.row').trigger('submit');
  await until(() => store.state.error?.message === 'no agent.send');
  await until(() => Reflect.get(wrapper.findComponent(Composer).vm, 'sending') === false);
  expect(wrapper.find('textarea').element.value).toBe('keep me');
  store.stop();
});

test('offers to stop a running agent and asks the box to interrupt', async () => {
  const box = await pairedStore([], { 'agent.interrupt': () => ({}) });
  const { store, relay, event } = box;
  const wrapper = mount(SessionView, { props: { store, session: 's1' } });
  expect(wrapper.findAll('.toolbar button').map((b) => b.text())).toEqual([
    'Files',
    'Changes (0)',
    '⋯',
  ]);
  await relay.emit(event(1, 'session.state', { state: 'running' }));
  await until(() => store.state.sessions[0]?.state === 'running');
  await flushPromises();
  await wrapper.find('.toolbar button').trigger('click');
  await until(() => box.calls('agent.interrupt').length === 1);
  expect(box.calls('agent.interrupt')).toEqual([{ session: 's1' }]);
  await wrapper
    .findAll('.toolbar button')
    .find((b) => b.text().startsWith('Changes'))
    ?.trigger('click');
  expect(wrapper.emitted('changes')).toEqual([[]]);
  store.stop();
});

test('the Files button opens the worktree browser', async () => {
  const box = await pairedStore([]);
  const { store } = box;
  const wrapper = mount(SessionView, { props: { store, session: 's1' } });
  await wrapper
    .findAll('.toolbar button')
    .find((b) => b.text() === 'Files')
    ?.trigger('click');
  expect(wrapper.emitted('files')).toEqual([[]]);
  store.stop();
});

// happy-dom has no layout, so the scroller's geometry is pinned by hand: a 1000 px log in a
// 200 px viewport, `scrollTop` writable so the component's jumps show up.
const withGeometry = (el: HTMLElement): HTMLElement => {
  Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 200, configurable: true });
  Object.defineProperty(el, 'scrollTop', { value: 800, writable: true, configurable: true });
  return el;
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
  const el = withGeometry(wrapper.find<HTMLElement>('.timeline').element);
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

// The delta buffer goes through the same Markdown pass as the final message: a fence that has
// not closed yet is already a code block, and closing it (or the reply landing) leaves the
// same block with no stray backticks.
test('the streaming bubble renders an open fence as a code block until it closes', async () => {
  const box = await pairedStore([]);
  const { store, relay, event } = box;
  const wrapper = mount(SessionView, { props: { store, session: 's1' } });
  await until(() => store.state.logs['s1'] !== undefined);
  await relay.ephemeral({ type: 'delta', session: 's1', forSeq: 1, text: 'Run:\n```sh\nls -' });
  await until(() => store.state.logs['s1']?.streaming === 'Run:\n```sh\nls -');
  await flushPromises();
  expect(wrapper.find('.streaming p').text()).toBe('Run:');
  expect(wrapper.find('.streaming pre.open > code.language-sh').text()).toBe('ls -');
  expect(wrapper.find('.streaming').text()).not.toContain('`');
  await relay.ephemeral({ type: 'delta', session: 's1', forSeq: 1, text: 'la\n```\n' });
  await until(() => store.state.logs['s1']?.streaming === 'Run:\n```sh\nls -la\n```\n');
  await flushPromises();
  expect(wrapper.find('.streaming pre.open').exists()).toBe(false);
  expect(wrapper.find('.streaming pre > code.language-sh').text()).toBe('ls -la');
  expect(wrapper.find('.streaming').text()).not.toContain('`');
  await relay.emit(event(1, 'msg.assistant', { text: 'Run:\n```sh\nls -la\n```\n' }));
  await until(() => store.state.logs['s1']?.lastSeq === 1);
  await flushPromises();
  expect(wrapper.find('.streaming').exists()).toBe(false);
  expect(wrapper.find('.item.assistant pre > code.language-sh').text()).toBe('ls -la');
  store.stop();
});

const started = (taskId: string, toolUseId: string, description: string): unknown => ({
  taskId,
  toolUseId,
  description,
  background: false,
  agentType: 'Explore',
});

// A row's first line: the disclosure's summary where there is one, else the whole row.
const heading = (item: DOMWrapper<Element>): string =>
  item.find('summary').exists() ? item.find('summary').text() : item.text();

// A session whose agent has spawned one subagent that has done one thing so far.
const withSubagent = async (): Promise<{ box: PairedStore; wrapper: VueWrapper }> => {
  const box = await pairedStore([]);
  const { store, relay, event } = box;
  const wrapper = mount(SessionView, { props: { store, session: 's1' } });
  await until(() => store.state.logs['s1'] !== undefined);
  await relay.emit(event(1, 'session.state', { state: 'running' }));
  await relay.emit(
    event(2, 'tool.start', { toolId: 'u1', name: 'Agent', input: {}, summary: 'Agent: ls' }),
  );
  await relay.emit(event(3, 'task.started', started('t1', 'u1', 'List files')));
  await relay.emit({ ...event(4, 'msg.user', { text: 'List the files' }), parent: 'u1' });
  await relay.emit({
    ...event(5, 'tool.start', { toolId: 'b', name: 'Bash', input: {}, summary: 'Bash: ls' }),
    parent: 'u1',
  });
  await relay.emit({ ...event(6, 'raw', { agent: 'claude', data: {} }), parent: 'u1' });
  await until(() => store.state.logs['s1']?.lastSeq === 6);
  await flushPromises();
  return { box, wrapper };
};

// A subagent's rows belong to its own chat: the strip appears with the first task, main keeps
// only the task note (tappable), and the subagent's chat shows its rows with a note in place
// of the composer, since nothing can be said to a subagent.
test('subagent events live in their own chat, reached from the task note', async () => {
  const { box, wrapper } = await withSubagent();
  expect(stripRows(wrapper)).toEqual(['main', 'Explore List files']);
  expect(wrapper.findAll('.item').map((i) => i.text())).toEqual([
    'Agent running',
    'Agent: ls',
    'Task: Explore · List files ›',
  ]);
  expect(wrapper.find('.composer').exists()).toBe(true);
  await wrapper.find('.item button.task').trigger('click');
  await flushPromises();
  expect(wrapper.findAll('.item').map((i) => i.text())).toEqual(['List the files', 'Bash: ls']);
  expect(wrapper.find('.composer').exists()).toBe(false);
  expect(wrapper.find('.aside .hint').text()).toBe('Messages go to main');
  expect(wrapper.findAll('.agents .row')[1]?.classes()).toContain('active');
  box.store.stop();
});

test('a task ending is said where the composer was, Back and the strip switch chats', async () => {
  const { box, wrapper } = await withSubagent();
  const { store, relay, event } = box;
  await wrapper.findAll('.agents .row')[1]?.trigger('click');
  await flushPromises();
  expect(wrapper.findAll('.item').length).toBe(2);
  await relay.emit(event(7, 'task.ended', { taskId: 't1', status: 'completed', summary: 'a, b' }));
  await relay.emit(event(8, 'msg.assistant', { text: 'done' }));
  await until(() => store.state.logs['s1']?.lastSeq === 8);
  await flushPromises();
  expect(wrapper.find('.aside .hint').text()).toBe('Task completed. Messages go to main');
  expect(stripRows(wrapper)[1]).toBe('○ Explore List files');
  await wrapper.find('.aside button').trigger('click');
  await flushPromises();
  expect(wrapper.findAll('.item').map((i) => heading(i))).toEqual([
    'Agent running',
    'Agent: ls',
    'Task: Explore · List files ›',
    'Task completed',
    'done',
  ]);
  expect(wrapper.find('.composer').exists()).toBe(true);
  await wrapper.findAll('.agents .row')[1]?.trigger('click');
  await flushPromises();
  expect(wrapper.findAll('.item').length).toBe(2);
  store.stop();
});

// The next message closes the turn: an ended task leaves the strip, which goes with it until a
// new task starts (a lone `main` row is noise); its note in main still opens its chat, and while that chat is open its row is back (highlighted) for Back.
test('an ended task leaves the strip on the next message, kept while its chat is open', async () => {
  const { box, wrapper } = await withSubagent();
  const { store, relay, event } = box;
  await relay.emit(event(7, 'task.ended', { taskId: 't1', status: 'completed', summary: 'a' }));
  await relay.emit(event(8, 'msg.user', { text: 'next' }));
  await until(() => store.state.logs['s1']?.lastSeq === 8);
  await flushPromises();
  expect(wrapper.find('.agents').exists()).toBe(false);
  await relay.emit(event(9, 'task.started', started('t2', 'u2', 'Read a.txt')));
  await until(() => store.state.logs['s1']?.lastSeq === 9);
  await flushPromises();
  expect(stripRows(wrapper)).toEqual(['main', 'Explore Read a.txt']);
  await wrapper.find('.item button.task').trigger('click');
  await flushPromises();
  expect(stripRows(wrapper)).toEqual(['main', '○ Explore List files', 'Explore Read a.txt']);
  expect(wrapper.findAll('.agents .row')[1]?.classes()).toContain('active');
  await wrapper.find('.aside button').trigger('click');
  await flushPromises();
  expect(stripRows(wrapper)).toEqual(['main', 'Explore Read a.txt']);
  store.stop();
});

// Hundreds of rows per task is normal; the last 200 render and a button brings the rest.
test('a long subagent chat shows its last 200 rows until asked for earlier ones', async () => {
  const ts = '2026-01-01T00:00:00Z';
  const events: FluxEvent[] = [
    { seq: 1, ts, session: 's1', type: 'task.started', payload: started('t1', 'u1', 'Long') },
  ];
  for (let seq = 2; seq <= 252; seq += 1) {
    const payload = { text: `row ${seq}` };
    events.push({ seq, ts, session: 's1', type: 'msg.assistant', payload, parent: 'u1' });
  }
  const box = await pairedStore(events);
  const { store } = box;
  const wrapper = mount(SessionView, { props: { store, session: 's1' } });
  await until(() => store.state.logs['s1']?.lastSeq === 252);
  await flushPromises();
  await wrapper.findAll('.agents .row')[1]?.trigger('click');
  await flushPromises();
  expect(wrapper.findAll('.item').length).toBe(200);
  expect(wrapper.find('.item').text()).toBe('row 53');
  expect(wrapper.find('.earlier').text()).toBe('Show 51 earlier');
  // The operator is at the top to press it; the rows it brings in are old, not new activity.
  const el = withGeometry(wrapper.find<HTMLElement>('.timeline').element);
  await scrollTo(el, 0);
  await wrapper.find('.earlier').trigger('click');
  await flushPromises();
  expect(wrapper.findAll('.item').length).toBe(251);
  expect(wrapper.find('.earlier').exists()).toBe(false);
  expect(wrapper.find('.new-activity').exists()).toBe(false);
  expect(el.scrollTop).toBe(0);
  store.stop();
});

test('reply from a bubble menu sends replyTo, shows the chip, and clears on send', async () => {
  const box = await pairedStore([], { 'agent.send': () => ({ seq: 2 }) });
  const { store, relay, event } = box;
  const wrapper = mount(SessionView, { props: { store, session: 's1' } });
  await until(() => store.state.logs['s1'] !== undefined);
  await relay.emit(event(1, 'msg.assistant', { text: 'Two options:\n\nA or B' }));
  await until(() => store.state.logs['s1']?.lastSeq === 1);
  await flushPromises();
  await wrapper.find('.assistant .trigger').trigger('click');
  await wrapper.findAll('.assistant [role="menuitem"]')[1]?.trigger('click');
  expect(wrapper.find('.composer .reply .who').text()).toBe('Replying to the agent');
  expect(wrapper.find('.composer .reply .line').text()).toBe('Two options:');
  await wrapper.find('textarea').setValue('B');
  await wrapper.find('form.row').trigger('submit');
  await until(() => box.calls('agent.send').length === 1);
  expect(box.calls('agent.send')).toEqual([{ session: 's1', text: 'B', replyTo: 1 }]);
  await until(() => Reflect.get(wrapper.findComponent(Composer).vm, 'sending') === false);
  await flushPromises();
  expect(wrapper.find('.composer .reply').exists()).toBe(false);
  await relay.emit(event(2, 'msg.user', { text: 'B', replyTo: 1 }));
  await until(() => store.state.logs['s1']?.lastSeq === 2);
  await flushPromises();
  expect(wrapper.find('.user .quote').text()).toBe('↩ Two options:');
  await wrapper.find('.user .trigger').trigger('click');
  await wrapper.findAll('.user [role="menuitem"]')[1]?.trigger('click');
  expect(wrapper.find('.composer .reply .who').text()).toBe('Replying to you');
  await wrapper.find('.composer .reply button').trigger('click');
  expect(wrapper.find('.composer .reply').exists()).toBe(false);
  store.stop();
});

// Reopened from the list, a session's rows are in the store before the view mounts, and its
// thumbnails went when it was left: they are fetched again on mount, not only on new rows.
test('thumbnails are fetched again when a session already loaded is shown again', async () => {
  const image = { id: 'img-1', name: 'shot.png', mime: 'image/png', size: 1, image: true };
  const row: FluxEvent = {
    seq: 1,
    ts: 't',
    session: 's1',
    type: 'msg.user',
    payload: { text: 'see', attachments: [image] },
  };
  const { store, calls } = await pairedStore([row], {
    'attach.read': () => ({ data: 'AA==', size: 1, mime: 'image/png', name: 'shot.png' }),
  });
  const first = mount(SessionView, { props: { store, session: 's1' } });
  await until(() => store.state.thumbs['img-1'] !== undefined);
  await flushPromises();
  expect(first.find('.files img').exists()).toBe(true);
  first.unmount();
  expect(store.state.thumbs).toEqual({});
  const again = mount(SessionView, { props: { store, session: 's1' } });
  await until(() => store.state.thumbs['img-1'] !== undefined);
  expect(calls('attach.read')).toHaveLength(2);
  await flushPromises();
  expect(again.find('.files img').exists()).toBe(true);
  again.unmount();
  store.stop();
});
