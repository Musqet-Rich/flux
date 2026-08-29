import type { DOMWrapper } from '@vue/test-utils';
import { mount } from '@vue/test-utils';
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
  const wrapper = mount(AgentStrip, { props: { tasks, active: null, busy: true } });
  const rows = wrapper.findAll('.row');
  expect(rows.map((r) => label(r))).toEqual([
    'main',
    'Explore List files',
    '○ Explore Read a.txt',
    '✗ agent List files',
    '✗ Explore List files',
    'Explore Running ls',
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
  const wrapper = mount(AgentStrip, { props: { tasks, active: 'u1', busy: false } });
  const rows = wrapper.findAll('.row');
  expect(rows[0]?.find('.glyph').text()).toBe('●');
  expect(rows[1]?.classes()).toContain('active');
  await rows[0]?.trigger('click');
  await rows[1]?.trigger('click');
  expect(wrapper.emitted('select')).toEqual([[null], ['u1']]);
});

// The strip renders what it is given: an old turn's task reaches it only as the open chat,
// and then it is a row, highlighted, so the operator knows where they are.
test('lists exactly the rows given, the viewed one highlighted', () => {
  const tasks = [task({ taskId: 't1', toolUseId: 'u1', status: 'completed', current: false })];
  const wrapper = mount(AgentStrip, { props: { tasks, active: 'u1', busy: false } });
  const rows = wrapper.findAll('.row');
  expect(rows.map((r) => label(r))).toEqual(['● main', '○ Explore List files']);
  expect(rows[1]?.classes()).toContain('active');
  expect(rows[1]?.attributes('aria-pressed')).toBe('true');
});
