import { expect, test } from 'vitest';

import { fluxEvent } from './flux-event.ts';

const valid = {
  seq: 1,
  ts: '2026-08-29T00:00:00Z',
  session: '01J',
  type: 'msg.assistant',
  payload: { text: 'hi' },
};

test('accepts a well-formed event', () => {
  expect(fluxEvent.is(valid)).toBe(true);
});

const rejected: [unknown, string][] = [
  [{ ...valid, seq: 0 }, 'seq below 1'],
  [{ ...valid, seq: 1.5 }, 'fractional seq'],
  [{ ...valid, ts: 1 }, 'non-string ts'],
  [{ ...valid, session: undefined }, 'missing session'],
  [{ ...valid, type: 'msg.future' }, 'unknown type'],
  [{ ...valid, type: 7 }, 'non-string type'],
  [{ ...valid, payload: { text: 1 } }, 'payload fails its guard'],
  [{ seq: 1, ts: 't', session: 's', type: 'raw' }, 'missing payload'],
  [[], 'array'],
  ['msg', 'string'],
];

test.each(rejected)('rejects %j (%s)', (value) => {
  expect(fluxEvent.is(value)).toBe(false);
});

test('lists every event type from protocol.md § 5', () => {
  expect([...fluxEvent.types].toSorted()).toEqual(
    [
      'session.created',
      'session.state',
      'session.renamed',
      'msg.user',
      'msg.assistant',
      'tool.start',
      'tool.end',
      'turn.ended',
      'rate_limit',
      'ask',
      'ask.answered',
      'notify',
      'files.changed',
      'comment.added',
      'comment.removed',
      'comment.sent',
      'raw',
    ].toSorted(),
  );
});
