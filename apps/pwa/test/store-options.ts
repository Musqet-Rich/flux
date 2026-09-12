import { createMemoryStorage } from '../src/client/create-memory-storage.ts';
import type { StoreOptions } from '../src/store/store-state.ts';
import { fakeAppearance } from './fake-appearance.ts';

// Options for a store built in a test: memory storage and a fake appearance unless given, and
// whatever the test adds (a recording `playSound`, a socket to a fake relay).
export const storeOptions = (
  given: Partial<StoreOptions> & Pick<StoreOptions, 'socket'>,
): StoreOptions => ({
  storage: createMemoryStorage(),
  appearance: fakeAppearance(),
  ...given,
});
