import { expect, test } from 'vitest';

import { createMemoryStorage } from './create-memory-storage.ts';

test('memory storage stores copies and forgets on remove', async () => {
  const storage = createMemoryStorage();
  const value = { a: [1, 2] };
  await storage.set('k', value);
  value.a.push(3);
  expect(await storage.get('k')).toEqual({ a: [1, 2] });
  await storage.remove('k');
  expect(await storage.get('k')).toBeUndefined();
});
