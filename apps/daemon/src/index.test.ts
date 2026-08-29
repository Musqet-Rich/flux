import { expect, test } from 'vitest';

import { daemonName } from './index.ts';

test('daemonName includes the protocol identifier', () => {
  expect(daemonName()).toBe('flux-daemon:flux-protocol');
});
