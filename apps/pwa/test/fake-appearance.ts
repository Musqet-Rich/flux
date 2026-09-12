import type { Appearance } from '../src/appearance/appearance.ts';
import { appearance } from '../src/appearance/appearance.ts';

// A device appearance over a map and a dark system, for stores built in tests.
export const fakeAppearance = (): Appearance => {
  const map = new Map<string, string>();
  return appearance.create(
    {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value);
      },
    },
    { dark: true, onChange: () => {} },
  );
};
