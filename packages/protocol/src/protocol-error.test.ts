import { expect, test } from 'vitest';

import { ProtocolError } from './protocol-error.ts';

test('carries a stable code and a human message', () => {
  const err = new ProtocolError('bad_frame', 'frame too short');
  expect(err).toBeInstanceOf(Error);
  expect(err.name).toBe('ProtocolError');
  expect(err.code).toBe('bad_frame');
  expect(err.message).toBe('frame too short');
});
