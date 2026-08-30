import { readFileSync } from 'node:fs';
import type { UserConfig } from 'tsdown';
import { defineConfig } from 'tsdown';

// The single app version (ADR 0021), read from the root package.json at config load and stamped
// into every build below as `FLUX_VERSION` (src/version.ts reads it). Reading it here rather
// than importing across the package boundary keeps `rootDir`/JSON resolution out of it.
const readVersion = (): string => {
  const pkg: unknown = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  );
  return typeof pkg === 'object' &&
    pkg !== null &&
    'version' in pkg &&
    typeof pkg.version === 'string'
    ? pkg.version
    : '0.0.0';
};
const version = readVersion();

// Four entries: `flux` (dist/index.mjs), the MCP server the agent spawns per session
// (dist/flux-mcp.mjs; create-mcp-config.ts resolves it as a sibling of index.mjs), the manager
// MCP server a manager session spawns (dist/flux-manager-mcp.mjs; ADR 0025, resolved the same
// way) and the pi extension pi loads per session (dist/flux-pi-extension.mjs; pi-extension-path.ts).
// They are separate builds rather than one multi-entry build so each is a single ESM file with no shared
// chunk (engineering.md § Toolchain). `@flux/protocol` is bundled in so the built daemon has no
// runtime dependency on the workspace; node built-ins stay external. Each build cleans only its
// own file: the two run concurrently and a whole-directory clean would race the other's output.
const single = (name: string, source: string): UserConfig => ({
  entry: { [name]: source },
  platform: 'node',
  define: { FLUX_VERSION: JSON.stringify(version) },
  deps: { alwaysBundle: ['@flux/protocol'] },
  clean: [`dist/${name}.mjs`],
});

export default defineConfig([
  single('index', 'src/index.ts'),
  single('flux-mcp', 'src/flux-mcp.ts'),
  single('flux-manager-mcp', 'src/flux-manager-mcp.ts'),
  single('flux-pi-extension', 'src/pi/flux-pi-extension.ts'),
]);
