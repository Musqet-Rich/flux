import { afterEach, expect, test, vi } from 'vitest';

import { writeClipboard } from './write-clipboard.ts';

// The one clipboard write behind every Copy: true when it took, false when the clipboard is
// missing (plain http) or refuses, never a rejection.

const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
  if (original === undefined) delete (navigator as { clipboard?: unknown }).clipboard;
  else Object.defineProperty(navigator, 'clipboard', original);
});

test('a clipboard that takes the text answers true', async () => {
  const writeText = vi.fn<() => Promise<void>>(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  expect(await writeClipboard('x')).toBe(true);
  expect(writeText).toHaveBeenCalledWith('x');
});

test('a refusing clipboard answers false', async () => {
  const writeText = vi.fn<() => Promise<void>>(() => Promise.reject(new Error('denied')));
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  expect(await writeClipboard('x')).toBe(false);
});

test('no clipboard at all answers false', async () => {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  expect(await writeClipboard('x')).toBe(false);
});
