import type { FluxEvent } from '@flux/protocol';
import { expect, test } from 'vitest';

import { quotedMessage } from './quoted-message.ts';

const ev = (type: string, payload: unknown, parent?: string): FluxEvent => ({
  seq: 7,
  ts: '2026-01-01T00:00:00Z',
  session: 's1',
  type,
  payload,
  ...(parent === undefined ? {} : { parent }),
});

test('only a top-level user or assistant message can be answered', () => {
  expect(quotedMessage(ev('msg.user', { text: 'do x' }))).toEqual({
    seq: 7,
    from: 'user',
    text: 'do x',
  });
  expect(quotedMessage(ev('msg.assistant', { text: 'done' }))).toEqual({
    seq: 7,
    from: 'assistant',
    text: 'done',
  });
  const missing: FluxEvent[] = [];
  expect(quotedMessage(missing[0])).toBeNull();
  expect(quotedMessage(ev('turn.ended', {}))).toBeNull();
  expect(quotedMessage(ev('made.up', { text: 'x' }))).toBeNull();
  // A subagent's prompt is the agent's, not the operator's, and its replies never reach main.
  expect(quotedMessage(ev('msg.user', { text: 'sub prompt' }, 'toolu_1'))).toBeNull();
  expect(quotedMessage(ev('msg.assistant', { text: 'sub report' }, 'toolu_1'))).toBeNull();
});
