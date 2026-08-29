import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Writes the per-session `.mcp.json` that injects the Flux tools into an agent (ADR 0008) and
// returns its path for `--mcp-config`. The MCP server is this package's flux-mcp entry, run by
// the same Node binary as the daemon.

export interface McpConfigOptions {
  dataDir: string;
  controlSocket: string;
}

// In development the entry is the .ts source (Node strips types); a build emits flux-mcp.mjs.
const mcpEntry = (): string => {
  const self = import.meta.url;
  const sibling = self.endsWith('.ts') ? './flux-mcp.ts' : './flux-mcp.mjs';
  return fileURLToPath(new URL(sibling, self));
};

export const createMcpConfig = (options: McpConfigOptions): ((session: string) => string) => {
  const dir = join(options.dataDir, 'mcp');
  mkdirSync(dir, { recursive: true });
  const entry = mcpEntry();
  return (session) => {
    const path = join(dir, `${session}.json`);
    const config = {
      mcpServers: {
        flux: {
          command: process.execPath,
          args: [entry],
          env: { FLUX_CONTROL_SOCKET: options.controlSocket, FLUX_SESSION: session },
        },
      },
    };
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
    return path;
  };
};
