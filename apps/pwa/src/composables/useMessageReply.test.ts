import type { FluxEvent } from '@flux/protocol';
import { expect, test } from 'vitest';

import { useMessageReply } from './useMessageReply.ts';

const ev = (seq: number, type: string, payload: unknown): FluxEvent => ({
  seq,
  ts: '2026-01-01T00:00:00Z',
  session: 's1',
  type,
  payload,
});

test('a reply is picked by seq from the messages, quoted on the row that answers it', () => {
  const asked = ev(1, 'msg.assistant', { text: 'Which?' });
  const tool = ev(2, 'tool.start', { toolId: 't', name: 'Bash', input: {}, summary: 'ls' });
  const answer = ev(3, 'msg.user', { text: 'this', replyTo: 1 });
  const toTool = ev(4, 'msg.user', { text: 'other', replyTo: 2 });
  const events = [asked, tool, answer, toTool];
  const { reply, quoteOf, startReply, cancelReply } = useMessageReply(() => events);
  expect(reply.value).toBeNull();
  startReply(1);
  expect(reply.value).toEqual({ seq: 1, from: 'assistant', text: 'Which?' });
  startReply(3);
  expect(reply.value).toEqual({ seq: 3, from: 'user', text: 'this' });
  startReply(2);
  expect(reply.value).toBeNull();
  startReply(1);
  cancelReply();
  expect(reply.value).toBeNull();
  expect(quoteOf(answer)).toBe('Which?');
  expect(quoteOf(toTool)).toBeUndefined();
  expect(quoteOf(asked)).toBeNull();
  expect(quoteOf(tool)).toBeNull();
  expect(quoteOf(ev(5, 'msg.user', { text: 'plain' }))).toBeNull();
});
