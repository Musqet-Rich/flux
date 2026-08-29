import { expect, test } from 'vitest';

import { daemonName } from './index.ts';

test('daemonName includes the protocol version', () => {
  expect(daemonName()).toBe('flux-daemon:v1');
});
