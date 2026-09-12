import { expect, test } from 'vitest';

import { pairedStore } from '../../test/paired-store.ts';
import { createMemoryStorage } from '../client/create-memory-storage.ts';
import { sendKey } from './send-key.ts';

// The send key is the device's own: kept in its storage, back on the next boot, and a value
// no build of the app wrote is ignored rather than trusted.

test('picking a send key keeps it for the next boot; an unknown stored value is ignored', async () => {
  const storage = createMemoryStorage();
  const first = await pairedStore([], {}, { storage });
  expect(first.store.state.sendKey).toBe('meta');
  expect(await first.store.setSendKey('shift')).toBe(true);
  expect(first.store.state.sendKey).toBe('shift');
  expect(await storage.get(sendKey.storageKey)).toBe('shift');
  first.store.stop();
  const second = await pairedStore([], {}, { storage });
  expect(second.store.state.sendKey).toBe('shift');
  second.store.stop();
  await storage.set(sendKey.storageKey, 'return');
  const third = await pairedStore([], {}, { storage });
  expect(third.store.state.sendKey).toBe('meta');
  third.store.stop();
});
