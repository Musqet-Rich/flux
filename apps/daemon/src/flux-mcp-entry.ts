import { fileURLToPath } from 'node:url';

// The absolute path of this package's flux-mcp entry, resolved the same way for the bundled daemon
// (a `.mjs` sibling of index.mjs) and the source checkout (the `.ts` beside it). Its own file so
// both the Claude `.mcp.json` writer (create-mcp-config.ts) and the opencode config writer
// (create-opencode-config.ts, ADR 0027) inject the identical server. The sibling strings are
// literals (not built from a name) so the built index.mjs carries them verbatim, which
// test/built-daemon.test.ts pins and is how the file resolves at runtime.
export const fluxMcpEntry = (): string => {
  const self = import.meta.url;
  return fileURLToPath(new URL(self.endsWith('.ts') ? './flux-mcp.ts' : './flux-mcp.mjs', self));
};
