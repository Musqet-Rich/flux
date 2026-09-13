import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { createMemoryStorage } from '../client/create-memory-storage.ts';
import { switchKey } from './switch-key.ts';

// The switch chord is the device's own: kept in its storage, back on the next boot, and a
// value no build of the app wrote is ignored rather than trusted.

test('picking a switch chord keeps it for the next boot; an unknown stored value is ignored', async () => {
  const storage = createMemoryStorage();
  const first = await pairedStore([], {}, { storage });
  expect(first.store.state.switchKey).toBe('ctrlAlt');
  expect(await first.store.setSwitchKey('altUpDown')).toBe(true);
  expect(first.store.state.switchKey).toBe('altUpDown');
  expect(await storage.get(switchKey.storageKey)).toBe('altUpDown');
  first.store.stop();
  const second = await pairedStore([], {}, { storage });
  expect(second.store.state.switchKey).toBe('altUpDown');
  second.store.stop();
  await storage.set(switchKey.storageKey, 'tab');
  const third = await pairedStore([], {}, { storage });
  expect(third.store.state.switchKey).toBe('ctrlAlt');
  third.store.stop();
});
