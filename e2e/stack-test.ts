import { test } from '@playwright/test';

import type { Stack } from './start-stack.ts';
import { startStack } from './start-stack.ts';

// Playwright's `test` with the stack as a fixture, started fresh for every test (a relay, a
// daemon and a repository take about a second) so a repeated run never meets the previous
// run's sessions, branches or burnt pairing secret. A fixture rather than `globalSetup`
// because a global setup file must default-export a function, which the lint set forbids, and
// because a fixture's lifetime and teardown are Playwright's to manage.

export const stackTest = test.extend<{ stack: Stack }>({
  stack: async ({ browserName }, use) => {
    const stack = await startStack(browserName);
    await use(stack);
    await stack.stop();
  },
});
