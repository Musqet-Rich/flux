import { expect, test } from 'vitest';

import { fluxEvent } from './flux-event.ts';

const valid = {
  seq: 1,
  ts: '2026-08-29T00:00:00Z',
  session: '01J',
  type: 'msg.assistant',
  payload: { text: 'hi' },
};

const future = { ...valid, type: 'msg.future', payload: { anything: [1, 2] } };

test('accepts a well-formed event', () => {
  expect(fluxEvent.is(valid)).toBe(true);
});

// A type this build does not know is version skew, not corruption (protocol.md § 8).
test('accepts an event of an unknown type with any payload', () => {
  expect(fluxEvent.is(future)).toBe(true);
  expect(fluxEvent.is({ ...future, payload: null })).toBe(true);
});

const rejected: [unknown, string][] = [
  [{ ...valid, seq: 0 }, 'seq below 1'],
  [{ ...valid, seq: 1.5 }, 'fractional seq'],
  [{ ...valid, ts: 1 }, 'non-string ts'],
  [{ ...valid, session: undefined }, 'missing session'],
  [{ ...valid, type: 7 }, 'non-string type'],
  [{ ...valid, payload: { text: 1 } }, 'known type, payload fails its guard'],
  [{ seq: 1, ts: 't', session: 's', type: 'raw' }, 'missing payload'],
  [{ seq: 1, ts: 't', session: 's', type: 'msg.future' }, 'unknown type, missing payload'],
  [[], 'array'],
  ['msg', 'string'],
];

test.each(rejected)('rejects %j (%s)', (value) => {
  expect(fluxEvent.is(value)).toBe(false);
});

// isKnown partitions on type alone; payload validation belongs to `is`, so a known type never
// reads as unknown even when handed something `is` would have refused.
test('isKnown separates known types from the rest without re-checking the payload', () => {
  expect(fluxEvent.isKnown(valid)).toBe(true);
  expect(fluxEvent.isKnown({ ...valid, payload: { text: 1 } })).toBe(true);
  expect(fluxEvent.isKnown(future)).toBe(false);
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
      'task.started',
      'task.ended',
      'pr.published',
      'hook.failed',
      'raw',
    ].toSorted(),
  );
});
