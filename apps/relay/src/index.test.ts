import { expect, test } from 'vitest';

import { relayName } from './index.ts';

test('relayName includes the protocol version', () => {
  expect(relayName()).toBe('flux-relay:v1');
});
