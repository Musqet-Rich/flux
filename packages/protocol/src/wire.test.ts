import { expect, test } from 'vitest';

import { wire } from './wire.ts';

const event = {
  seq: 1,
  ts: 't',
  session: 's',
  type: 'msg.assistant',
  payload: { text: 'hi' },
};

const cases: [unknown, boolean][] = [
  [{ kind: 'event', event }, true],
  [{ kind: 'event', event: { ...event, seq: 0 } }, false],
  [{ kind: 'ephemeral', data: { type: 'typing', session: 's', deviceId: 'd' } }, true],
  [{ kind: 'ephemeral', data: { type: 'typing' } }, false],
  [{ kind: 'rpc', id: '1', method: 'sessions.list', params: {} }, true],
  [{ kind: 'rpc', id: '1', method: 'sessions.list', params: null }, true],
  [{ kind: 'rpc', id: '1', method: 'sessions.list' }, false],
  [{ kind: 'rpc', id: 1, method: 'sessions.list', params: {} }, false],
  [{ kind: 'rpc', id: '1', params: {} }, false],
  [{ kind: 'rpc.result', id: '1', ok: true, result: [] }, true],
  [{ kind: 'rpc.result', id: '1', ok: true }, false],
  [{ kind: 'rpc.result', id: '1', ok: false, error: { code: 'not_found', message: 'x' } }, true],
  [{ kind: 'rpc.result', id: '1', ok: false, error: { code: 'not_found' } }, false],
  [{ kind: 'rpc.result', id: '1', ok: 'yes', result: 1 }, false],
  [{ kind: 'rpc.result', ok: true, result: 1 }, false],
  [{ kind: 'unknown' }, false],
  [{}, false],
  [null, false],
];

test.each(cases)('wire.is(%j) is %s', (value, expected) => {
  expect(wire.is(value)).toBe(expected);
});

test.each([
  [{ code: 'internal', message: 'boom' }, true],
  [{ code: 'internal', message: 'boom', data: { any: 1 } }, true],
  [{ code: 'internal' }, false],
  [{ message: 'boom' }, false],
  ['boom', false],
])('wire.isRpcError(%j) is %s', (value, expected) => {
  expect(wire.isRpcError(value)).toBe(expected);
});
