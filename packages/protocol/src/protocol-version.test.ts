import { expect, test } from 'vitest';

import { protocolVersion } from './protocol-version.ts';

test('protocol version is 1', () => {
  expect(protocolVersion).toBe(1);
});
