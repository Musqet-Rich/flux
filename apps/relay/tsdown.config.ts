import { defineConfig } from 'tsdown';

// One entry, one ESM file (engineering.md § Toolchain). `@flux/protocol` is bundled in; hono,
// @hono/node-server and ws stay external and are installed next to dist by `pnpm install`.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  platform: 'node',
  deps: { alwaysBundle: ['@flux/protocol'] },
});
