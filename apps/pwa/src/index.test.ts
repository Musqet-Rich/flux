import { expect, test } from 'vitest';

import { pwaName } from './index.ts';

test('pwaName includes the protocol version', () => {
  expect(pwaName()).toBe('flux-pwa:v1');
});
