import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { createMemoryStorage } from '../client/create-memory-storage.ts';
import { foldedStrips } from './folded-strips.ts';

// Which strips are folded is the device's own: kept in its storage, back on the next boot,
// newest last and capped, and a stored value no build wrote is ignored rather than trusted.

test('a folded strip stays folded on the next boot, and opening it forgets it', async () => {
  const storage = createMemoryStorage();
  const first = await pairedStore([], {}, { storage });
  expect(first.store.state.foldedStrips).toEqual([]);
  expect(await first.store.setStripFolded('a', true)).toBe(true);
  expect(await first.store.setStripFolded('b', true)).toBe(true);
  expect(await first.store.setStripFolded('a', true)).toBe(true);
  expect(first.store.state.foldedStrips).toEqual(['b', 'a']);
  expect(await storage.get(foldedStrips.storageKey)).toEqual(['b', 'a']);
  first.store.stop();
  const second = await pairedStore([], {}, { storage });
  expect(second.store.state.foldedStrips).toEqual(['b', 'a']);
  expect(await second.store.setStripFolded('b', false)).toBe(true);
  expect(second.store.state.foldedStrips).toEqual(['a']);
  second.store.stop();
  await storage.set(foldedStrips.storageKey, ['a', 7]);
  const third = await pairedStore([], {}, { storage });
  expect(third.store.state.foldedStrips).toEqual([]);
  third.store.stop();
});

test('the list keeps the newest folds only', async () => {
  const storage = createMemoryStorage();
  const ids = Array.from({ length: foldedStrips.limit + 5 }, (_, n) => `s${n}`);
  await storage.set(foldedStrips.storageKey, ids);
  const box = await pairedStore([], {}, { storage });
  expect(box.store.state.foldedStrips).toEqual(ids.slice(5));
  expect(await box.store.setStripFolded('new', true)).toBe(true);
  expect(box.store.state.foldedStrips).toHaveLength(foldedStrips.limit);
  expect(box.store.state.foldedStrips.at(-1)).toBe('new');
  expect(box.store.state.foldedStrips[0]).toBe('s6');
  box.store.stop();
});
