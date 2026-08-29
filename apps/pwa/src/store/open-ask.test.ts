import type { FluxEvent } from '@flux/protocol';
import { expect, test } from 'vitest';

import { openAsk } from './open-ask.ts';

const ev = (seq: number, type: string, payload: unknown): FluxEvent =>
  ({ seq, ts: '2026-01-01T00:00:00Z', session: 's1', type, payload }) as FluxEvent;

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
