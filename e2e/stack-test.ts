import { test } from '@playwright/test';

import type { Stack } from './start-stack.ts';
import { startStack } from './start-stack.ts';

// Playwright's `test` with the stack as a fixture, started fresh for every test (a relay, a
// daemon and a repository take about a second) so a repeated run never meets the previous
// run's sessions, branches or burnt pairing secret. A fixture rather than `globalSetup`
// because a global setup file must default-export a function, which the lint set forbids, and
// because a fixture's lifetime and teardown are Playwright's to manage. `capture` is the
// stream-json file the fake agent replays; a test file overrides it with `test.use`.

export const stackTest = test.extend<{ capture: string | undefined; stack: Stack }>({
  capture: [undefined, { option: true }],
  stack: async ({ browserName, capture }, use) => {
    const stack = await startStack(browserName, capture);
    await use(stack);
    await stack.stop();
  },
});
