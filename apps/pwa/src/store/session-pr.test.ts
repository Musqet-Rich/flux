import type { FluxEvent } from '@flux/protocol';
import { expect, test } from 'vitest';

import { sessionPr } from './session-pr.ts';

const ev = (seq: number, type: string, payload: unknown): FluxEvent => ({
  seq,
  ts: 't',
  session: 's1',
  type,
  payload,
});
const pr = (n: number) => ({
  provider: 'github',
  url: `https://github.com/o/r/pull/${n}`,
  repo: 'o/r',
  identifier: String(n),
  action: 'created',
});

test('the latest published PR wins, and none is null', () => {
  expect(sessionPr([])).toBeNull();
  expect(sessionPr([ev(1, 'msg.user', { text: 'x' })])).toBeNull();
  const events = [
    ev(1, 'pr.published', pr(3)),
    ev(2, 'msg.user', { text: 'x' }),
    ev(3, 'pr.published', pr(4)),
  ];
  expect(sessionPr(events)).toEqual(pr(4));
});
