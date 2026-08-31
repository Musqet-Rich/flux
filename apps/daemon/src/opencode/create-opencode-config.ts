import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { fluxMcpEntry } from '../flux-mcp-entry.ts';

// Writes the per-session opencode config that injects the Flux tools floor and role (ADR 0027
// § 4/§ 5) and returns its path for `OPENCODE_CONFIG`. Both the config and the instructions file
// live under the flux data dir, never in the session worktree, so opencode's cwd-based discovery
// picks up nothing and `git status`/the Changes view stay clean (the anti-pollution mechanism):
// opencode reads config from `OPENCODE_CONFIG` and the flux prompt from an absolute `instructions`
// path, both proven headlessly with `opencode mcp list`.

export interface OpencodeConfigOptions {
  dataDir: string;
  controlSocket: string;
}

// Goes with the Flux tools (ADR 0008): the agent has no interactive prompt in headless mode, so
// it is told how to reach the operator instead of guessing or stalling. Kept per harness (as
// spawn-claude.ts / spawn-pi.ts do) rather than shared, so each harness owns its own wording.
const fluxPrompt =
  'You are running unattended under Flux. The operator is on a phone. For any material decision ' +
  '(design choices, destructive actions, ambiguous requirements) call flux_ask instead of guessing; ' +
  'call flux_notify with level "done" when the task is complete and "blocked" when you cannot proceed.';

// The Agent's role (ADR 0023 § 2) is appended after the Flux prompt, never in its place, so the
// operator channel survives whatever the role says.
const instructions = (role: string | undefined): string =>
  role === undefined ? fluxPrompt : `${fluxPrompt}\n\n${role}`;

const config = (options: OpencodeConfigOptions, session: string, instructionsPath: string) => ({
  $schema: 'https://opencode.ai/config.json',
  instructions: [instructionsPath],
  mcp: {
    flux: {
      type: 'local',
      command: [process.execPath, fluxMcpEntry()],
      environment: { FLUX_CONTROL_SOCKET: options.controlSocket, FLUX_SESSION: session },
      enabled: true,
    },
  },
});

export const createOpencodeConfig = (
  options: OpencodeConfigOptions,
): ((session: string, role?: string) => string) => {
  const dir = join(options.dataDir, 'opencode');
  mkdirSync(dir, { recursive: true });
  return (session, role) => {
    const instructionsPath = join(dir, `${session}.md`);
    const configPath = join(dir, `${session}.json`);
    writeFileSync(instructionsPath, instructions(role));
    writeFileSync(
      configPath,
      `${JSON.stringify(config(options, session, instructionsPath), null, 2)}\n`,
    );
    return configPath;
  };
};
