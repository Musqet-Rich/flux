import type { FluxEvent } from '@flux/protocol';
import { expect, test } from 'vitest';

import { createSessionLog } from './create-session-log.ts';

const at = (seq: number, session = 's'): FluxEvent => ({
  seq,
  ts: '2026-01-01T00:00:00Z',
  session,
  type: 'msg.user',
  payload: { text: `m${seq}` },
});

test('applies the next seq, ignores stale, reports gaps', () => {
  const log = createSessionLog('s');
  expect(log.receive(at(1))).toBe('applied');
  expect(log.receive(at(1))).toBe('stale');
  expect(log.receive(at(3))).toBe('gap');
  expect(log.receive(at(2, 'other'))).toBe('stale');
  expect(log.lastSeq()).toBe(1);
  expect(log.version()).toBe(1);
});

test('pages fill in order and skip what is already held', () => {
  const log = createSessionLog('s', [at(1), at(2)]);
  log.applyPage([at(1), at(2), at(3), at(5)]);
  expect(log.events().map((e) => e.seq)).toEqual([1, 2, 3]);
  log.applyPage([at(4), at(5)]);
  expect(log.lastSeq()).toBe(5);
});

test('deltas accumulate for one forSeq, reset on a new forSeq, and clear when the message lands', () => {
  const log = createSessionLog('s', [at(1)]);
  log.delta({ type: 'delta', session: 's', forSeq: 2, text: 'Hel' });
  log.delta({ type: 'delta', session: 's', forSeq: 2, text: 'lo' });
  expect(log.streaming()).toBe('Hello');
  log.delta({ type: 'delta', session: 's', forSeq: 3, text: '' });
  expect(log.streaming()).toBe('');
  log.delta({ type: 'delta', session: 's', forSeq: 3, text: 'Again' });
  log.delta({ type: 'delta', session: 'other', forSeq: 3, text: 'no' });
  log.delta({ type: 'delta', session: 's', forSeq: 1, text: 'old' });
  log.delta({ type: 'agent.status', session: 's', status: 'thinking' });
  expect(log.streaming()).toBe('Again');
  log.receive(at(2));
  expect(log.streaming()).toBe('Again');
  log.receive(at(3));
  expect(log.streaming()).toBe('');
});
