import type { FluxEvent } from '@flux/protocol';
import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';

import EventItem from './EventItem.vue';
import MessageMenu from './MessageMenu.vue';

const ev = (type: string, payload: unknown): FluxEvent => ({
  seq: 1,
  ts: '2026-01-01T00:00:00Z',
  session: 's1',
  type,
  payload,
});

test('renders messages as bubbles on the right side', () => {
  const user = mount(EventItem, { props: { event: ev('msg.user', { text: 'hello' }) } });
  expect(user.find('.item').classes()).toContain('user');
  expect(user.text()).toBe('hello');
  const bot = mount(EventItem, { props: { event: ev('msg.assistant', { text: 'hi' }) } });
  expect(bot.find('.item').classes()).toContain('assistant');
});

test('messages on both sides are rendered as Markdown', () => {
  const bot = mount(EventItem, {
    props: { event: ev('msg.assistant', { text: '## Done\n\n- `a.ts` **saved**\n\n<b>x</b>' }) },
  });
  expect(bot.find('.markdown p.heading strong').text()).toBe('Done');
  expect(bot.find('.markdown li code').text()).toBe('a.ts');
  expect(bot.find('.markdown li strong').text()).toBe('saved');
  expect(bot.find('b').exists()).toBe(false);
  expect(bot.text()).toContain('<b>x</b>');
  const user = mount(EventItem, {
    props: { event: ev('msg.user', { text: '**bold** too\n\n| a | b |\n|---|---|\n| 1 | 2 |' }) },
  });
  expect(user.find('.user .markdown strong').text()).toBe('bold');
  expect(user.find('.user .markdown td').text()).toBe('1');
  // The menu's Copy and Reply work on the text as typed, not the rendered tree.
  expect(user.findComponent(MessageMenu).props('text')).toBe(
    '**bold** too\n\n| a | b |\n|---|---|\n| 1 | 2 |',
  );
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
  ];
  for (const [event, text] of notes) {
    expect(mount(EventItem, { props: { event } }).find('.note').text()).toBe(text);
  }
});

const pr = {
  provider: 'github',
  url: 'https://github.com/o/r/pull/19',
  repo: 'o/r',
  identifier: '19',
  action: 'created',
};

test('a published PR is a link, a failed hook keeps stderr behind a summary', () => {
  const link = mount(EventItem, { props: { event: ev('pr.published', pr) } }).find('a.link');
  expect(link.text()).toBe('Pull request #19 created · o/r');
  expect(link.attributes()).toMatchObject({
    href: 'https://github.com/o/r/pull/19',
    target: '_blank',
    rel: 'noopener noreferrer',
  });
  const hook = { hookName: 'Stop:lint', hookEvent: 'Stop', exitCode: 2, stderr: 'lint: 3 errors' };
  const warning = mount(EventItem, { props: { event: ev('hook.failed', hook) } });
  expect(warning.find('details summary').text()).toBe('Hook Stop:lint failed (exit 2)');
  expect(warning.find('.stderr').text()).toBe('lint: 3 errors');
  expect(warning.find('.item').classes()).toContain('warn');
  const quiet = ev('hook.failed', { hookName: 'h', hookEvent: 'Stop', stderr: '' });
  const bare = mount(EventItem, { props: { event: quiet } });
  expect(bare.find('details').exists()).toBe(false);
  expect(bare.find('.note').text()).toBe('Hook h failed');
});

// A newer box may log types this build does not know (protocol.md § 8); they render like raw.
test('raw and unknown types show their name with the payload behind a tap', async () => {
  const raw = mount(EventItem, {
    props: { event: ev('raw', { agent: 'claude', data: { k: 1 } }) },
  });
  expect(raw.find('.summary').text()).toBe('raw event');
  await raw.find('.summary').trigger('click');
  expect(raw.find('.detail').text()).toContain('"k": 1');
  expect(raw.find('.detail').text()).toContain('"agent": "claude"');
  const future = mount(EventItem, { props: { event: ev('msg.future', { any: 'thing' }) } });
  expect(future.find('.summary').text()).toBe('msg.future event');
  expect(future.find('.detail').exists()).toBe(false);
  await future.find('.summary').trigger('click');
  expect(future.find('.detail').text()).toContain('"any": "thing"');
});

// Tool output and raw agent lines can run to hundreds of KB; the detail is cut at 64 KiB.
test('a long detail is truncated with a marker', async () => {
  const wrapper = mount(EventItem, {
    props: { event: ev('raw', { agent: 'claude', data: 'x'.repeat(100 * 1024) }) },
  });
  await wrapper.find('.summary').trigger('click');
  const text = wrapper.find('.detail').text();
  expect(text.length).toBeLessThan(65 * 1024);
  expect(text.endsWith('… truncated at 64 KiB')).toBe(true);
});

// A manager agent's action (ADR 0025) is its own system note, one row per verb.
test('a manager.acted event renders a note for each action', () => {
  const cases: [string, string][] = [
    ['open', 'Manager · opened session s2'],
    ['close', 'Manager · archived s2'],
    ['read', 'Manager · read s2'],
  ];
  for (const [action, expected] of cases) {
    const item = mount(EventItem, {
      props: { event: ev('manager.acted', { actor: 'm1', action, target: 's2', detail: '' }) },
    });
    expect(item.find('.note').text()).toBe(expected);
  }
  const sent = mount(EventItem, {
    props: {
      event: ev('manager.acted', {
        actor: 'm1',
        action: 'send',
        target: 's2',
        detail: 'run tests',
      }),
    },
  });
  expect(sent.find('.note').text()).toBe('Manager · sent to s2: run tests');
});

test('a cleared context is a rule across the timeline', () => {
  const wrapper = mount(EventItem, { props: { event: ev('session.cleared', {}) } });
  expect(wrapper.find('.item').classes()).toContain('divider');
  expect(wrapper.find('.rule').attributes('role')).toBe('separator');
  expect(wrapper.text()).toBe('Context cleared');
});

// The compaction boundary rules across the timeline with the token delta read compactly and the
// duration in whole seconds; a non-success result says so instead.
test('a compaction boundary is a rule with the token delta and duration', () => {
  const ok = ev('compact.boundary', {
    trigger: 'manual',
    preTokens: 60065,
    postTokens: 6202,
    durationMs: 59369,
    result: 'success',
  });
  const wrapper = mount(EventItem, { props: { event: ok } });
  expect(wrapper.find('.item').classes()).toContain('divider');
  expect(wrapper.find('.rule').attributes('role')).toBe('separator');
  expect(wrapper.text()).toBe('Context compacted · 60k → 6.2k tokens · 59s');
  const failed = ev('compact.boundary', {
    trigger: 'manual',
    preTokens: 1,
    postTokens: 1,
    durationMs: 1,
    result: 'failure',
  });
  const bad = mount(EventItem, { props: { event: failed } });
  expect(bad.find('.item').classes()).toContain('warn');
  expect(bad.text()).toBe('Compaction failed');
});

// A task row opens that subagent's chat; the report behind a task's end is what the parent
// read, so it is kept whole, as Markdown, behind a disclosure rather than cut to one line.
test('a started task is a tappable note, an ended task keeps its report behind a summary', async () => {
  const task = { taskId: 't', toolUseId: 'u', description: 'Run tests', background: true };
  const bare = mount(EventItem, { props: { event: ev('task.started', task) } });
  expect(bare.find('button.task').text()).toBe('Background task: Run tests ›');
  await bare.find('button.task').trigger('click');
  expect(bare.emitted('task')).toEqual([['u']]);
  const typed = ev('task.started', { ...task, background: false, agentType: 'Explore' });
  expect(
    mount(EventItem, { props: { event: typed } })
      .find('button.task')
      .text(),
  ).toBe('Task: Explore · Run tests ›');
  const report = {
    taskId: 't',
    status: 'completed',
    summary: '## Found\n\n- `a.ts`',
    tokens: 12070,
  };
  const done = mount(EventItem, { props: { event: ev('task.ended', report) } });
  expect(done.find('details summary').text()).toBe('Task completed · 12.1k tokens');
  expect(done.find('.report .markdown p.heading strong').text()).toBe('Found');
  expect(done.find('.report li code').text()).toBe('a.ts');
  expect(done.find('.item').classes()).not.toContain('warn');
  const failed = mount(EventItem, {
    props: { event: ev('task.ended', { taskId: 't', status: 'failed', summary: '' }) },
  });
  expect(failed.find('details').exists()).toBe(false);
  expect(failed.find('.note').text()).toBe('Task failed');
  expect(failed.find('.item').classes()).toContain('warn');
});

test('message bubbles carry a menu on their inboard side; a reply row quotes its source', async () => {
  const user = mount(EventItem, {
    props: {
      event: { ...ev('msg.user', { text: 'hi', replyTo: 1 }), seq: 3 },
      quote: 'Plan\nmore',
    },
  });
  expect(user.find('.menu-root').classes()).toContain('left');
  expect(user.find('.item').attributes('data-seq')).toBe('3');
  expect(user.find('.quote').text()).toBe('↩ Plan');
  await user.find('.quote').trigger('click');
  expect(user.emitted('jump')).toEqual([[1]]);
  await user.find('.trigger').trigger('click');
  await user.findAll('[role="menuitem"]')[1]?.trigger('click');
  expect(user.emitted('reply')).toEqual([[3]]);
  const bot = mount(EventItem, { props: { event: ev('msg.assistant', { text: 'hi' }) } });
  expect(bot.find('.menu-root').classes()).toContain('right');
  expect(bot.find('.quote').exists()).toBe(false);
  const note = mount(EventItem, { props: { event: ev('turn.ended', {}) } });
  expect(note.find('.menu-root').exists()).toBe(false);
});

test('the reply chip skips blank leading lines and names a source the log lacks', () => {
  const blank = mount(EventItem, {
    props: { event: ev('msg.user', { text: 'hi', replyTo: 1 }), quote: '\n\n  \nSecond' },
  });
  expect(blank.find('.quote').text()).toBe('↩ Second');
  const gone = mount(EventItem, {
    props: { event: ev('msg.user', { text: 'hi', replyTo: 1 }), quote: null },
  });
  expect(gone.find('.quote').text()).toBe('↩ earlier message');
});

test('a user message lists its attachments under the text, thumbnails where fetched', () => {
  const attachments = [
    { id: 'a1', name: 'shot.png', mime: 'image/png', size: 75, image: true },
    { id: 'a2', name: 'notes.txt', mime: 'text/plain', size: 5, image: false },
  ];
  const user = mount(EventItem, {
    props: { event: ev('msg.user', { text: 'look', attachments }), thumbs: { a1: 'blob:x' } },
  });
  expect(user.find('.markdown').text()).toBe('look');
  expect(user.find('.files .image img').attributes('src')).toBe('blob:x');
  expect(user.find('.files .plain .name').text()).toBe('notes.txt');
  const bare = mount(EventItem, { props: { event: ev('msg.user', { text: 'plain' }) } });
  expect(bare.find('.files').exists()).toBe(false);
});
