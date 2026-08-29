import { expect, test } from 'vitest';

import { formatBytes } from './format-bytes.ts';

test('sizes read in the unit they fit', () => {
  expect(formatBytes(0)).toBe('0 B');
  expect(formatBytes(75)).toBe('75 B');
  expect(formatBytes(15 * 1024)).toBe('15.0 KiB');
  expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.5 MiB');
  expect(formatBytes(200 * 1024 * 1024)).toBe('200 MiB');
  expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GiB');
  expect(formatBytes(3000 * 1024 ** 3)).toBe('3000 GiB');
});
