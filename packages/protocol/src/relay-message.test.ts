import { expect, test } from 'vitest';

import { relayMessage } from './relay-message.ts';

test.each([
  [{ v: 2, role: 'host', token: 't' }, true],
  [{ v: 2, role: 'guest' }, true],
  [{ v: 2, role: 'host' }, false],
  [{ v: 2, role: 'host', token: 1 }, false],
  [{ v: 1, role: 'guest' }, false],
  [{ v: 2, role: 'admin' }, false],
  [{ role: 'guest' }, false],
  ['guest', false],
])('isJoin(%j) is %s', (value, expected) => {
  expect(relayMessage.isJoin(value)).toBe(expected);
});

test.each([
  [{ ok: true }, true],
  [{ ok: false, error: 'bad_version' }, true],
  [{ ok: false, error: 'bad_token' }, true],
  [{ ok: false, error: 'host_present' }, true],
  [{ ok: false, error: 'room_full' }, true],
  [{ ok: false, error: 'banned' }, false],
  [{ ok: false }, false],
  [{ ok: 'true' }, false],
  [{}, false],
  [null, false],
])('isJoinReply(%j) is %s', (value, expected) => {
  expect(relayMessage.isJoinReply(value)).toBe(expected);
});

test.each([
  [{ type: 'no_host' }, true],
  [{ type: 'host_joined' }, true],
  [{ type: 'host_left' }, true],
  [{ type: 'guest_left' }, false],
  [{}, false],
  [undefined, false],
])('isControl(%j) is %s', (value, expected) => {
  expect(relayMessage.isControl(value)).toBe(expected);
});
