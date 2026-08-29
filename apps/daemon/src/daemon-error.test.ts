import { expect, test } from 'vitest';

import { DaemonError } from './daemon-error.ts';

test('carries an RPC error code', () => {
  const err = new DaemonError('not_found', 'no such session');
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe('DaemonError');
  expect(err.code).toBe('not_found');
  expect(err.message).toBe('no such session');
});
