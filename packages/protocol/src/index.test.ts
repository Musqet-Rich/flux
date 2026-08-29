import { expect, test } from 'vitest';

import { protocolName } from './index.ts';

test('protocolName returns the package identifier', () => {
  expect(protocolName()).toBe('flux-protocol');
});
