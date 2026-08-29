import type { UserConfig } from 'tsdown';
import { defineConfig } from 'tsdown';

// Three entries: `flux` (dist/index.mjs), the MCP server the agent spawns per session
// (dist/flux-mcp.mjs; create-mcp-config.ts resolves it as a sibling of index.mjs) and the pi
// extension pi loads per session (dist/flux-pi-extension.mjs; pi-extension-path.ts). They are
// separate builds rather than one two-entry build so each is a single ESM file with no shared
// chunk (engineering.md § Toolchain). `@flux/protocol` is bundled in so the built daemon has no
// runtime dependency on the workspace; node built-ins stay external. Each build cleans only its
// own file: the two run concurrently and a whole-directory clean would race the other's output.
const single = (name: string, source: string): UserConfig => ({
  entry: { [name]: source },
  platform: 'node',
  deps: { alwaysBundle: ['@flux/protocol'] },
  clean: [`dist/${name}.mjs`],
});

export default defineConfig([
  single('index', 'src/index.ts'),
  single('flux-mcp', 'src/flux-mcp.ts'),
  single('flux-pi-extension', 'src/pi/flux-pi-extension.ts'),
]);
