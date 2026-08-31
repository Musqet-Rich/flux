import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fluxMcpEntry } from './flux-mcp-entry.ts';

// Writes the per-session `.mcp.json` that injects the Flux tools into an agent (ADR 0008) and
// returns its path for `--mcp-config`. The MCP server is this package's flux-mcp entry (shared
// with the opencode writer via flux-mcp-entry.ts), run by the same Node binary as the daemon. A
// manager session (ADR 0025) additionally gets a separate `flux-manager` server, so the
// fleet-control tools never leak into an ordinary agent.

export interface McpConfigOptions {
  dataDir: string;
  controlSocket: string;
}

// In development the entry is the .ts source (Node strips types); a build emits the `.mjs`. Both
// sibling strings are spelled out as literals (not built from a name) so the built `index.mjs`
// contains them verbatim, which test/built-daemon.test.ts checks and how the file resolves.
const entryFor = (tsSibling: string, mjsSibling: string): string => {
  const self = import.meta.url;
  return fileURLToPath(new URL(self.endsWith('.ts') ? tsSibling : mjsSibling, self));
};

const serverEntry = (entry: string, socket: string, session: string) => ({
  command: process.execPath,
  args: [entry],
  env: { FLUX_CONTROL_SOCKET: socket, FLUX_SESSION: session },
});

// `manager` is the resolved session flag: only a manager session gets the `flux-manager` server.
// When false the config is byte-identical to a non-manager build (a single `flux` server).
export const createMcpConfig = (
  options: McpConfigOptions,
): ((session: string, manager: boolean) => string) => {
  const dir = join(options.dataDir, 'mcp');
  mkdirSync(dir, { recursive: true });
  const fluxEntry = fluxMcpEntry();
  const managerEntry = entryFor('./flux-manager-mcp.ts', './flux-manager-mcp.mjs');
  return (session, manager) => {
    const path = join(dir, `${session}.json`);
    const config = {
      mcpServers: {
        flux: serverEntry(fluxEntry, options.controlSocket, session),
        ...(manager
          ? { 'flux-manager': serverEntry(managerEntry, options.controlSocket, session) }
          : {}),
      },
    };
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
    return path;
  };
};
