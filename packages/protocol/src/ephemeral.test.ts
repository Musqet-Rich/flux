import { expect, test } from 'vitest';

import { ephemeral } from './ephemeral.ts';

test.each([
  [{ type: 'delta', session: 's', forSeq: 3, text: 'abc' }, true],
  [{ type: 'delta', session: 's', forSeq: 3, text: '' }, true],
  [{ type: 'delta', session: 's', forSeq: 0, text: '' }, false],
  [{ type: 'delta', session: 's', text: '' }, false],
  [{ type: 'delta', session: 's', forSeq: 1 }, false],
  [{ type: 'typing', session: 's', deviceId: 'd' }, true],
  [{ type: 'typing', session: 's' }, false],
  [{ type: 'agent.status', session: 's', status: 'thinking' }, true],
  [{ type: 'agent.status', session: 's', status: 'tool' }, true],
  [{ type: 'agent.status', session: 's', status: 'idle' }, true],
  [{ type: 'agent.status', session: 's', status: 'sleeping' }, false],
  [{ type: 'presence', session: 's' }, false],
  [{ type: 'device.revoked', deviceId: 'd' }, true],
  [{ type: 'device.revoked' }, false],
  [{ type: 'delta', forSeq: 1, text: '' }, false],
  [{ type: 'delta', session: 1, forSeq: 1, text: '' }, false],
  [null, false],
  ['delta', false],
])('ephemeral.is(%j) is %s', (value, expected) => {
  expect(ephemeral.is(value)).toBe(expected);
});
