import { expect, test } from 'vitest';

import { createEventLog } from './create-event-log.ts';
import { DaemonError } from './daemon-error.ts';
import { openDatabase } from './open-database.ts';

const fixedNow = (): Date => new Date('2026-08-29T10:00:00.000Z');

const setup = () => createEventLog({ db: openDatabase(':memory:'), now: fixedNow });

test('appends with a gapless per-session seq and a box timestamp', () => {
  const log = setup();
  const a = log.append('s1', { type: 'msg.user', payload: { text: 'hi' } });
  const b = log.append('s1', { type: 'msg.assistant', payload: { text: 'hello' } });
  const other = log.append('s2', { type: 'msg.user', payload: { text: 'x' } });
  expect(a).toEqual({
    seq: 1,
    ts: '2026-08-29T10:00:00.000Z',
    session: 's1',
    type: 'msg.user',
    payload: { text: 'hi' },
  });
  expect(b.seq).toBe(2);
  expect(other.seq).toBe(1);
  expect(log.lastSeq('s1')).toBe(2);
  expect(log.lastSeq('nope')).toBe(0);
});

test('reads pages after a seq and reports completeness', () => {
  const log = setup();
  for (let i = 0; i < 5; i++) log.append('s', { type: 'msg.user', payload: { text: `${i}` } });
  const first = log.read('s', 0, 2);
  expect(first.events.map((e) => e.seq)).toEqual([1, 2]);
  expect(first.complete).toBe(false);
  const rest = log.read('s', 2, 10);
  expect(rest.events.map((e) => e.seq)).toEqual([3, 4, 5]);
  expect(rest.complete).toBe(true);
  expect(log.read('s', 5)).toEqual({ events: [], complete: true });
});

test('round-trips every payload shape through JSON', () => {
  const log = setup();
  const payload = {
    toolId: 't1',
    name: 'Bash',
    input: { command: 'ls', nested: [1, { a: null }] },
    summary: 'Bash: ls',
  };
  log.append('s', { type: 'tool.start', payload });
  expect(log.read('s', 0).events[0]?.payload).toEqual(payload);
});

test('refuses an invalid payload without consuming a seq', () => {
  const log = setup();
  const bad: unknown = { text: 42 };
  expect(() => log.append('s', { type: 'msg.user', payload: bad as { text: string } })).toThrow(
    DaemonError,
  );
  expect(log.lastSeq('s')).toBe(0);
  expect(log.append('s', { type: 'msg.user', payload: { text: 'ok' } }).seq).toBe(1);
});

test('uses the wall clock by default', () => {
  const log = createEventLog({ db: openDatabase(':memory:') });
  const event = log.append('s', { type: 'msg.user', payload: { text: 'x' } });
  expect(Number.isNaN(Date.parse(event.ts))).toBe(false);
});
