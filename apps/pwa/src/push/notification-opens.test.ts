import { expect, test } from 'vitest';

import { notificationOpens } from './notification-opens.ts';

// A window a daemon's worker opened carries the daemon in its query (sw.ts, ADR 0037).
test('reads the daemon a notification named from the query, if any', () => {
  expect(notificationOpens.fromQuery('?daemon=abc_-1')).toBe('abc_-1');
  expect(notificationOpens.fromQuery('?path=x')).toBeUndefined();
  expect(notificationOpens.fromQuery('')).toBeUndefined();
});
