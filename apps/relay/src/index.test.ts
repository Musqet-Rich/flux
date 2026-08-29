import { expect, test } from 'vitest';

import { relayName } from './index.ts';

test('relayName includes the protocol identifier', () => {
  expect(relayName()).toBe('flux-relay:flux-protocol');
});
