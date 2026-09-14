import type { FluxEvent } from '@flux/protocol';
import { expect, test } from 'vitest';

import { logFold } from './log-fold.ts';
import { openAsk as fold } from './open-ask.ts';

const openAsk = (events: FluxEvent[]) => logFold.run(events, fold);

const ev = (seq: number, type: string, payload: unknown): FluxEvent => ({
  seq,
  ts: '2026-01-01T00:00:00Z',
  session: 's1',
  type,
  payload,
});

const ask = (askId: string) => ({
  askId,
  question: `q ${askId}`,
  timeoutAt: '2026-01-01T01:00:00Z',
});

test('the latest unanswered ask is open; an answered one is not', () => {
  expect(openAsk([])).toBeNull();
  expect(openAsk([ev(1, 'ask', ask('a'))])).toEqual(ask('a'));
  expect(
    openAsk([
      ev(1, 'ask', ask('a')),
      ev(2, 'ask.answered', { askId: 'a', answer: 'y', by: 'device' }),
    ]),
  ).toBeNull();
  expect(
    openAsk([
      ev(1, 'ask', ask('a')),
      ev(2, 'ask', ask('b')),
      ev(3, 'ask.answered', { askId: 'a', answer: 'y', by: 'timeout' }),
    ]),
  ).toEqual(ask('b'));
});

test('a cleared context settles whatever was asked before it', () => {
  expect(openAsk([ev(1, 'ask', ask('a')), ev(2, 'session.cleared', {})])).toBeNull();
  expect(openAsk([ev(1, 'session.cleared', {}), ev(2, 'ask', ask('b'))])).toEqual(ask('b'));
});

// Stepped one event at a time, as the screen keeps it: an event that changes nothing returns
// the value given, so the screen has nothing to redo.
test('the fold keeps the open ask across steps and returns it unchanged for other events', () => {
  const { step } = fold;
  const open = step(fold.init(), ev(1, 'ask', ask('a')));
  expect(open).toEqual(ask('a'));
  expect(step(open, ev(2, 'msg.assistant', { text: 'x' }))).toBe(open);
  expect(step(open, ev(3, 'ask.answered', { askId: 'other', answer: 'y' }))).toBe(open);
  expect(step(open, ev(4, 'ask.answered', { askId: 'a', answer: 'y' }))).toBeNull();
  expect(step(open, ev(5, 'session.cleared', {}))).toBeNull();
});
