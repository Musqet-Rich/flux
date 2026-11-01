import type { DOMWrapper } from '@vue/test-utils';
import { flushPromises, mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import type { SessionTask } from '../store/session-tasks.ts';
import AgentStrip from './AgentStrip.vue';

const task = (over: Partial<SessionTask>): SessionTask => ({
  taskId: 't',
  toolUseId: 'u',
  parent: null,
  depth: 0,
  agentType: 'Explore',
  description: 'List files',
  progress: null,
  status: 'running',
  summary: '',
  tokens: null,
  current: true,
  ...over,
});

// A row as read: glyph, type and description with a space between (the spinner has no text).
const label = (row: DOMWrapper<Element>): string =>
  row
    .findAll('span')
    .map((span) => span.text())
    .filter((text) => text !== '')
    .join(' ');

test('lists main then every task with its state glyph, type and description', () => {
  const tasks = [
    task({ taskId: 't1', toolUseId: 'u1' }),
    task({ taskId: 't2', toolUseId: 'u2', status: 'completed', description: 'Read a.txt' }),
    task({ taskId: 't3', toolUseId: 'u3', status: 'failed', agentType: null, depth: 1 }),
    task({ taskId: 't4', toolUseId: 'u4', status: 'interrupted' }),
    task({ taskId: 't5', toolUseId: 'u5', progress: 'Running ls' }),
  ];
  const wrapper = mount(AgentStrip, { props: { tasks, active: null, busy: true, folded: false } });
  const rows = wrapper.findAll('.row');
  expect(rows.map((r) => label(r))).toEqual([
    'main',
    'Explore List files',
    'Explore Read a.txt',
    'agent List files',
    'Explore List files',
    'Explore Running ls',
  ]);
  // The ended rows carry a state icon; main and the running tasks carry the spinner instead.
  expect(rows.slice(2, 5).map((r) => r.find('.glyph svg').attributes('data-icon'))).toEqual([
    'succeeded',
    'failed',
    'failed',
  ]);
  // main spins while the session runs, a task while it has not ended.
  expect(rows[0]?.find('.loader').exists()).toBe(true);
  expect(rows[1]?.find('.loader').exists()).toBe(true);
  expect(rows[2]?.find('.loader').exists()).toBe(false);
  expect(rows[0]?.classes()).toContain('active');
  expect(rows[0]?.attributes('aria-pressed')).toBe('true');
  expect(rows[3]?.classes()).toContain('failed');
  expect(rows[3]?.attributes('style')).toContain('padding-left: 1.75rem');
  expect(rows[4]?.classes()).toContain('muted');
  expect(rows[4]?.attributes('title')).toBe('interrupted');
});

test('selects a task or main on tap', async () => {
  const tasks = [task({ taskId: 't1', toolUseId: 'u1' })];
  const wrapper = mount(AgentStrip, { props: { tasks, active: 'u1', busy: false, folded: false } });
  const rows = wrapper.findAll('.row');
  expect(rows[0]?.find('.glyph svg').attributes('data-icon')).toBe('dot');
  expect(rows[1]?.classes()).toContain('active');
  await rows[0]?.trigger('click');
  await rows[1]?.trigger('click');
  expect(wrapper.emitted('select')).toEqual([[null], ['u1']]);
});

// The strip renders what it is given: an old turn's task reaches it only as the open chat,
// and then it is a row, highlighted, so the operator knows where they are.
test('lists exactly the rows given, the viewed one highlighted', () => {
  const tasks = [task({ taskId: 't1', toolUseId: 'u1', status: 'completed', current: false })];
  const wrapper = mount(AgentStrip, { props: { tasks, active: 'u1', busy: false, folded: false } });
  const rows = wrapper.findAll('.row');
  expect(rows.map((r) => label(r))).toEqual(['main', 'Explore List files']);
  expect(rows[1]?.classes()).toContain('active');
  expect(rows[1]?.attributes('aria-pressed')).toBe('true');
});

// Folded: one line naming the open chat with the count, a spinner while anything runs, and a
// tap that asks to open; open: the caret at the end of main's row asks to fold.
test('folded, it is one line that names the open chat and opens on a tap', async () => {
  const tasks = [
    task({ taskId: 't1', toolUseId: 'u1', agentType: 'Plan' }),
    task({ taskId: 't2', toolUseId: 'u2', status: 'completed' }),
  ];
  const wrapper = mount(AgentStrip, { props: { tasks, active: 'u1', busy: false, folded: true } });
  const rows = wrapper.findAll('.row');
  expect(rows.map((r) => label(r))).toEqual(['Plan 2 subagents, 1 running']);
  expect(rows[0]?.find('.loader').exists()).toBe(true);
  expect(rows[0]?.attributes('aria-expanded')).toBe('false');
  expect(rows[0]?.attributes('aria-label')).toBe('Show agents: Plan, 2 subagents, 1 running');
  await rows[0]?.trigger('click');
  expect(wrapper.emitted('fold')).toEqual([[false]]);
  expect(wrapper.emitted('select')).toBeUndefined();
});

test('folded with nothing running, it names main and has no spinner', () => {
  const tasks = [task({ status: 'completed' })];
  const wrapper = mount(AgentStrip, { props: { tasks, active: null, busy: false, folded: true } });
  expect(label(wrapper.find('.row'))).toBe('main 1 subagent');
  expect(wrapper.find('.loader').exists()).toBe(false);
});

test('open, the caret on main’s row asks to fold', async () => {
  const wrapper = mount(AgentStrip, {
    props: { tasks: [task({})], active: null, busy: true, folded: false },
  });
  const fold = wrapper.find('.fold');
  expect(fold.attributes('aria-expanded')).toBe('true');
  expect(fold.attributes('aria-label')).toBe('Hide agents');
  await fold.trigger('click');
  expect(wrapper.emitted('fold')).toEqual([[true]]);
});

test('folded, a chat not among the rows is named agent, and main running spins', () => {
  const wrapper = mount(AgentStrip, {
    props: { tasks: [task({ status: 'completed' })], active: 'gone', busy: true, folded: true },
  });
  expect(label(wrapper.find('.row'))).toBe('agent 1 subagent');
  expect(wrapper.find('.loader').exists()).toBe(true);
});

// The pressed control goes with the fold, so the focus moves to its counterpart; a fold set
// from outside leaves the focus alone.
test('the focus follows a fold and an unfold to the other control', async () => {
  const wrapper = mount(AgentStrip, {
    props: { tasks: [task({})], active: null, busy: false, folded: false },
    attachTo: document.body,
  });
  await wrapper.find('.fold').trigger('click');
  await wrapper.setProps({ folded: true });
  await flushPromises();
  expect(document.activeElement).toBe(wrapper.find('.unfold').element);
  await wrapper.find('.unfold').trigger('click');
  await wrapper.setProps({ folded: false });
  await flushPromises();
  expect(document.activeElement).toBe(wrapper.find('.fold').element);
  (document.activeElement as HTMLElement).blur();
  await wrapper.setProps({ folded: true });
  await flushPromises();
  expect(document.activeElement).toBe(document.body);
  wrapper.unmount();
});
