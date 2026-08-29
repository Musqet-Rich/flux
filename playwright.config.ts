import { defineConfig } from '@playwright/test';

// The one end-to-end flow (engineering.md § Testing) under Playwright, Chromium only: the PWA is
// served from its production build by the real relay, with the real daemon behind it driving
// the fixture-replaying fake agent (e2e/start-stack.ts). `pnpm run e2e` builds first; the stack
// refuses to start on a stale or missing dist so the test never passes against source.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.test.ts',
  // One flow, one worker: the stack is started per worker and holds ports and a data dir.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: 'list',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results',
  use: { browserName: 'chromium', trace: 'retain-on-failure' },
});
