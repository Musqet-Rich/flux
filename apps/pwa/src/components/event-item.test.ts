import type { FluxEvent } from '@flux/protocol';
import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import EventItem from './EventItem.vue';

const ev = (type: string, payload: unknown): FluxEvent =>
  ({ seq: 1, ts: '2026-01-01T00:00:00Z', session: 's1', type, payload }) as FluxEvent;

test('renders messages as bubbles on the right side', () => {
  const user = mount(EventItem, { props: { event: ev('msg.user', { text: 'hello' }) } });
  expect(user.find('.item').classes()).toContain('user');
  expect(user.text()).toBe('hello');
  const bot = mount(EventItem, { props: { event: ev('msg.assistant', { text: 'hi' }) } });
  expect(bot.find('.item').classes()).toContain('assistant');
});

test('tool events show their summary and open the detail on tap', async () => {
  const wrapper = mount(EventItem, {
    props: {
      event: ev('tool.end', { toolId: 't', ok: false, summary: 'Bash: ls', output: { a: 1 } }),
    },
  });
  expect(wrapper.find('.summary').text()).toBe('Bash: ls');
  expect(wrapper.find('.item').classes()).toContain('error');
  expect(wrapper.find('.detail').exists()).toBe(false);
  await wrapper.find('.summary').trigger('click');
  expect(wrapper.find('.detail').text()).toContain('"a": 1');
  const bare = mount(EventItem, {
    props: {
      event: ev('tool.start', { toolId: 't', name: 'Read', input: undefined, summary: 'Read x' }),
    },
  });
  expect(bare.find('.summary').attributes('disabled')).toBeDefined();
});

test('everything else is a one-line note', () => {
  const notes: [FluxEvent, string][] = [
    [ev('session.state', { state: 'waiting_user' }), 'Agent waiting user'],
    [ev('turn.ended', { costUsd: 0.1234 }), 'Turn ended · $0.123'],
    [ev('ask', { askId: 'a', question: 'Why?', timeoutAt: 'x' }), 'Asked: Why?'],
    [ev('notify', { level: 'blocked', summary: 'stuck' }), 'stuck'],
    [ev('files.changed', { files: [{ path: 'a', status: 'M' }] }), '1 file(s) changed'],
    [ev('comment.sent', { commentIds: ['a', 'b'], msgSeq: 3 }), '2 comment(s) sent'],
    [ev('raw', { agent: 'claude', data: null }), 'raw event'],
  ];
  for (const [event, text] of notes) {
    expect(mount(EventItem, { props: { event } }).find('.note').text()).toBe(text);
  }
});
