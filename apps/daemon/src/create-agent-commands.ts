import type { HarnessKind } from '@flux/protocol';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { createMcpConfig } from './create-mcp-config.ts';
import type { SupervisorPoolOptions } from './create-supervisor-pool.ts';
import { detectAgents } from './detect-agents.ts';
import { piExtensionPath } from './pi/pi-extension-path.ts';

// Everything about the harness binaries (not their config files, that is create-harness-config.ts) the daemon resolves once at start: which ones exist, and
// the spawn-time options the supervisor pool needs for each (ADR 0007, ADR 0008, ADR 0016).

export interface AgentCommandsInput {
  dataDir: string;
  controlSocket: string;
  claudeCommand?: string;
  piCommand?: string;
  piProvider?: string;
  piModel?: string;
}

export interface AgentCommands {
  agents: HarnessKind[];
  pool: Pick<SupervisorPoolOptions, 'claudeCommand' | 'pi' | 'mcpConfig' | 'env'>;
  // Drops what the agent kept for a session once it is archived: pi's session file (Claude's
  // transcript stays; ADR 0007 reads it as a source).
  forget: (session: string) => void;
}

// pi names session files `<timestamp>_<id>.jsonl` under one directory per cwd; the Flux session
// id is the id (spawn-pi.ts), so a walk for that suffix is the whole lookup.
const forgetPiSession = (sessionDir: string, session: string): void => {
  const suffix = `_${session}.jsonl`;
  let entries: { name: string; parentPath: string; isFile: () => boolean }[];
  try {
    entries = readdirSync(sessionDir, { recursive: true, withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(suffix)) {
      rmSync(join(entry.parentPath, entry.name), { force: true });
    }
  }
};

export const createAgentCommands = (input: AgentCommandsInput): AgentCommands => ({
  agents: detectAgents({ claude: input.claudeCommand ?? 'claude', pi: input.piCommand ?? 'pi' }),
  forget: (session) => {
    forgetPiSession(join(input.dataDir, 'pi-sessions'), session);
  },
  pool: {
    ...(input.claudeCommand === undefined ? {} : { claudeCommand: input.claudeCommand }),
    mcpConfig: createMcpConfig({ dataDir: input.dataDir, controlSocket: input.controlSocket }),
    pi: {
      sessionDir: join(input.dataDir, 'pi-sessions'),
      extension: piExtensionPath(),
      ...(input.piCommand === undefined ? {} : { command: input.piCommand }),
      ...(input.piProvider === undefined ? {} : { provider: input.piProvider }),
      ...(input.piModel === undefined ? {} : { model: input.piModel }),
    },
    // The pi extension reads these; Claude's MCP server gets the same pair from .mcp.json.
    env: (session) => ({
      ...process.env,
      FLUX_CONTROL_SOCKET: input.controlSocket,
      FLUX_SESSION: session,
    }),
  },
});
