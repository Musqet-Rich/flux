import { expect, test } from 'vitest';

import { handlerContext } from './handler-context.ts';

test('exists so the types-only module has a runtime surface', () => {
  expect(handlerContext.version).toBe(1);
});
