import { expect, test } from 'vitest';

import { DaemonError } from './daemon-error.ts';
import { inside } from './inside.ts';

test('accepts the root itself and paths under it', () => {
  expect(inside('/w', '.')).toBe('/w');
  expect(inside('/w', 'src/a.ts')).toBe('/w/src/a.ts');
  expect(inside('/w', './src/../src/a.ts')).toBe('/w/src/a.ts');
});

test('refuses paths that escape the root', () => {
  expect(() => inside('/w', '../etc/passwd')).toThrow(DaemonError);
  expect(() => inside('/w', '/etc/passwd')).toThrow(DaemonError);
  expect(() => inside('/w', '../w2')).toThrow(DaemonError);
});
