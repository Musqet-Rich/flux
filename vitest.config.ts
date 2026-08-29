import { defineConfig } from 'vitest/config';

// One Vitest run for the whole workspace, one project per package, each named after its
// package.json so `vitest --project @flux/<name>` works uniformly. Projects are defined inline
// rather than by glob because a glob-found project does not inherit the root `test` options:
// `extends: true` makes each one pick up `include` and `allowOnly` below, and the pwa extends
// its own vite.config.ts (it needs the Vue plugin) with the same options restated.
//
// PWA component tests (@vue/test-utils `mount`, engineering.md § Testing) need a DOM environment
// and therefore a `happy-dom` (or `jsdom`) dev dependency, which must go through the ADR 0010
// ledger first. No DOM project is configured until it lands; see docs/scaffold-notes.md.

// Tests are `thing.test.ts` next to `thing.ts` (engineering.md § Testing), so `.spec.ts` and
// files under `__tests__/` are not collected and cannot pass by accident. A `.only` left in a
// test file fails the run everywhere, not only under CI=1 (Vitest's default).
const testRules = {
  include: ['{src,test}/**/*.test.ts'],
  allowOnly: false,
};

export default defineConfig({
  test: {
    ...testRules,
    projects: [
      { extends: true, test: { name: '@flux/protocol', root: 'packages/protocol' } },
      { extends: true, test: { name: '@flux/daemon', root: 'apps/daemon' } },
      { extends: true, test: { name: '@flux/relay', root: 'apps/relay' } },
      {
        extends: './apps/pwa/vite.config.ts',
        test: { name: '@flux/pwa', root: 'apps/pwa', ...testRules },
      },
    ],
    // Coverage is measured and enforced for packages/protocol only
    // (docs/engineering.md § Testing: 100%, enforced).
    coverage: {
      provider: 'v8',
      include: ['packages/protocol/src/**/*.ts'],
      // Vitest hides fully covered files from the text table when it detects an AI agent
      // (skipFull defaults to true there). Always list every measured file so a reader can see
      // what the 100% gate actually covers.
      reporter: [['text', { skipFull: false }], 'lcov'],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
