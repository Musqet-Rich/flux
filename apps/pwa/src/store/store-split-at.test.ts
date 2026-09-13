import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { createMemoryStorage } from '../client/create-memory-storage.ts';
import { splitAt } from './split-at.ts';

// The divider's place is the device's own: kept in its storage, back on the next boot, clamped
// so neither pane can vanish, and a stored value no build wrote is ignored rather than trusted.

test('dragging the divider keeps its place for the next boot, within the clamp', async () => {
  const storage = createMemoryStorage();
  const first = await pairedStore([], {}, { storage });
  expect(first.store.state.splitAt).toBe(0.5);
  expect(await first.store.setSplitAt(0.62)).toBe(true);
  expect(first.store.state.splitAt).toBe(0.62);
  expect(await storage.get(splitAt.storageKey)).toBe(0.62);
  expect(await first.store.setSplitAt(0.95)).toBe(true);
  expect(first.store.state.splitAt).toBe(0.7);
  expect(await first.store.setSplitAt(0.01)).toBe(true);
  expect(first.store.state.splitAt).toBe(0.3);
  first.store.stop();
  const second = await pairedStore([], {}, { storage });
  expect(second.store.state.splitAt).toBe(0.3);
  second.store.stop();
  await storage.set(splitAt.storageKey, 'wide');
  const third = await pairedStore([], {}, { storage });
  expect(third.store.state.splitAt).toBe(0.5);
  third.store.stop();
  await storage.set(splitAt.storageKey, 0.9);
  const fourth = await pairedStore([], {}, { storage });
  expect(fourth.store.state.splitAt).toBe(0.5);
  fourth.store.stop();
});
