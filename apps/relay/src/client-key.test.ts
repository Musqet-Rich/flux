import type { IncomingMessage } from 'node:http';
import { expect, test } from 'vitest';

import { clientKey } from './client-key.ts';

// A minimal IncomingMessage: only the socket address and headers are read.
const request = (remoteAddress: string, forwarded?: string | string[]): IncomingMessage =>
  ({
    socket: { remoteAddress },
    headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded },
  }) as unknown as IncomingMessage;

test('without trustProxy the socket address is the key, whatever the header says', () => {
  expect(clientKey(request('127.0.0.1'), false)).toBe('127.0.0.1');
  expect(clientKey(request('127.0.0.1', '203.0.113.9'), false)).toBe('127.0.0.1');
});

test('with trustProxy the last forwarded hop is the key', () => {
  expect(clientKey(request('127.0.0.1', '203.0.113.9'), true)).toBe('203.0.113.9');
  expect(clientKey(request('127.0.0.1', '10.0.0.1, 203.0.113.9'), true)).toBe('203.0.113.9');
  expect(clientKey(request('127.0.0.1', ' 10.0.0.1 ,203.0.113.9 , '), true)).toBe('203.0.113.9');
  expect(clientKey(request('127.0.0.1', ['10.0.0.1', '203.0.113.9']), true)).toBe('203.0.113.9');
});

test('with trustProxy but no usable header the socket address is the key', () => {
  expect(clientKey(request('127.0.0.1'), true)).toBe('127.0.0.1');
  expect(clientKey(request('127.0.0.1', ''), true)).toBe('127.0.0.1');
  expect(clientKey(request('127.0.0.1', ' , '), true)).toBe('127.0.0.1');
});
