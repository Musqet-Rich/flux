import type { FluxEvent } from '@flux/protocol';
import { expect, test } from 'vitest';
import { reactive } from 'vue';

import { useSessionTimeline } from './useSessionTimeline.ts';

const event = (seq: number, type: string, payload: unknown, parent?: string): FluxEvent => ({
  seq,
  ts: '2026-01-01T00:00:00Z',
  session: 's1',
  type,
  payload,
  ...(parent === undefined ? {} : { parent }),
});

// The rows main shows: top-level, and none of the types that live elsewhere on the screen (the
// status bar, the Changes button, the agents strip, the toolbar's chip) or nowhere (`raw`).
test('main lists top-level rows and hides the types that show elsewhere', () => {
  const events = [
    event(1, 'msg.user', { text: 'go' }),
    event(2, 'raw', { agent: 'claude', data: {} }),
    event(3, 'agent.spec', { model: 'claude-fable-5-1', effort: 'high' }),
    event(4, 'rate_limit', { windows: [] }),
    event(5, 'files.changed', { files: [] }),
    event(6, 'task.progress', { taskId: 't', description: 'd' }),
    event(7, 'msg.assistant', { text: 'sub' }, 'call-1'),
    event(8, 'msg.assistant', { text: 'done' }),
  ];
  const { timeline, select } = useSessionTimeline(() => events);
  expect(timeline.value.map((e) => e.seq)).toEqual([1, 8]);
  select('call-1');
  expect(timeline.value.map((e) => e.seq)).toEqual([7]);
});

const many = (from: number, to: number): FluxEvent[] =>
  Array.from({ length: to - from + 1 }, (_, i) => event(from + i, 'msg.assistant', { text: '' }));

// The window is a count of rows left out at the top: `trim` sets it to keep the last 300,
// new rows grow the timeline until the next trim, Show earlier takes 200 off it, and `reveal`
// takes it down to a given row.
test('the window holds its top edge until trimmed, widened by a page or to a row', () => {
  // Reactive, as the store's log is, so a push reaches the computed rows.
  const events = reactive(many(1, 350));
  const chat = useSessionTimeline(() => events);
  const seqs = (): [number, number | undefined] => [
    chat.timeline.value.length,
    chat.timeline.value[0]?.seq,
  ];
  expect(seqs()).toEqual([350, 1]);
  chat.trim();
  expect(chat.earlier.value).toBe(50);
  expect(seqs()).toEqual([300, 51]);
  events.push(...many(351, 360));
  expect(seqs()).toEqual([310, 51]);
  chat.trim();
  expect(seqs()).toEqual([300, 61]);
  chat.reveal(61);
  expect(seqs()).toEqual([300, 61]);
  chat.reveal(999);
  expect(seqs()).toEqual([300, 61]);
  chat.reveal(40);
  expect(seqs()).toEqual([321, 40]);
  chat.showEarlier();
  expect(seqs()).toEqual([360, 1]);
  expect(chat.earlier.value).toBe(0);
  chat.trim();
  chat.select(null);
  expect(seqs()).toEqual([300, 61]);
  // A page is 200 rows, not the rest: a long history comes in a tap at a time.
  events.push(...many(361, 900));
  chat.trim();
  expect(seqs()).toEqual([300, 601]);
  chat.showEarlier();
  expect(chat.earlier.value).toBe(400);
  expect(seqs()).toEqual([500, 401]);
  chat.showEarlier();
  expect(seqs()).toEqual([700, 201]);
  // A chat with fewer rows than the window shows them all; the count is clamped to the rows.
  chat.select('call-1');
  expect(seqs()).toEqual([0, undefined]);
  events.push(event(901, 'msg.assistant', { text: 'sub' }, 'call-1'));
  expect(seqs()).toEqual([1, 901]);
});
