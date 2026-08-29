import { test } from '@playwright/test';

import type { Stack } from './start-stack.ts';
import { startStack } from './start-stack.ts';

// Playwright's `test` with the stack as a worker fixture: started once per worker before the
// first test, stopped after the last. A fixture rather than `globalSetup` because a global
// setup file must default-export a function, which the lint set forbids, and because a
// fixture's lifetime and teardown are Playwright's to manage.

export const stackTest = test.extend<Record<never, never>, { stack: Stack }>({
  stack: [
    async ({ browserName }, use) => {
      const stack = await startStack(browserName);
      await use(stack);
      await stack.stop();
    },
    { scope: 'worker', timeout: 60_000 },
  ],
});
