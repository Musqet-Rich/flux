import { expect, test } from 'vitest';

import { protocolVersion } from './protocol-version.ts';

test('protocol version is 2', () => {
  expect(protocolVersion).toBe(2);
});
