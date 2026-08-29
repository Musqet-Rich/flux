import { expect, test } from 'vitest';

import { pwaName } from './index.ts';

test('pwaName includes the protocol identifier', () => {
  expect(pwaName()).toBe('flux-pwa:flux-protocol');
});
