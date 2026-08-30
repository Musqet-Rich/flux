import { basename, dirname, join } from 'node:path';

// Where the installed bundle lives, or null for a dev build (ADR 0022 § 3). The three release
// files sit beside the running `index.mjs`, so `process.argv[1]` names the install directory. A
// daemon started from source (`node src/index.ts`) or missing its sibling bundles cannot
// self-update: the handler refuses such a target with `unsupported`. `exists` is injected so the
// detection is unit-testable without a real filesystem.

export interface DetectDistDeps {
  exists: (path: string) => boolean;
}

const bundleSiblings = ['flux-mcp.mjs', 'flux-pi-extension.mjs'];

export const detectDistDir = (argv1: string, deps: DetectDistDeps): string | null => {
  if (basename(argv1) !== 'index.mjs') return null;
  const dir = dirname(argv1);
  return bundleSiblings.every((name) => deps.exists(join(dir, name))) ? dir : null;
};
