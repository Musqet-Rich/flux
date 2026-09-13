import { effectScope } from 'vue';
import { afterEach, expect, test, vi } from 'vitest';

import { useWide } from './useWide.ts';

// A fake media query list that remembers its listener, so the test can resize the window.
const fakeMedia = (matches: boolean) => {
  const listeners: ((event: MediaQueryListEvent) => void)[] = [];
  const media = {
    matches,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.push(listener);
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.splice(listeners.indexOf(listener), 1);
    },
  };
  vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList);
  return {
    resize: (to: boolean): void => {
      for (const listener of listeners) listener({ matches: to } as MediaQueryListEvent);
    },
    listeners,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

test('reads the query, follows a resize across the line, and lets go on dispose', () => {
  const media = fakeMedia(true);
  const scope = effectScope();
  const wide = scope.run(() => useWide());
  expect(wide?.value).toBe(true);
  media.resize(false);
  expect(wide?.value).toBe(false);
  media.resize(true);
  expect(wide?.value).toBe(true);
  expect(media.listeners).toHaveLength(1);
  scope.stop();
  expect(media.listeners).toHaveLength(0);
});

test('a runtime without matchMedia is narrow', () => {
  const original = window.matchMedia;
  Reflect.deleteProperty(window, 'matchMedia');
  const scope = effectScope();
  expect(scope.run(() => useWide())?.value).toBe(false);
  scope.stop();
  window.matchMedia = original;
});
