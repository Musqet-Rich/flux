import type { AgentKind } from '@flux/protocol';
import { accessSync, constants } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

// Which agent binaries the box has, checked once at daemon start: `hello` reports the list so
// the PWA offers only agents that can run, and `sessions.create` refuses the others with
// `agent_unavailable`. A bare name is searched on PATH; a path is checked as given.

export interface DetectAgentsOptions {
  claude: string;
  pi: string;
  path?: string;
}

const executable = (file: string): boolean => {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const found = (command: string, path: string): boolean => {
  if (isAbsolute(command) || command.includes('/')) return executable(command);
  return path.split(delimiter).some((dir) => dir !== '' && executable(join(dir, command)));
};

export const detectAgents = (options: DetectAgentsOptions): AgentKind[] => {
  const path = options.path ?? process.env['PATH'] ?? '';
  const agents: AgentKind[] = [];
  if (found(options.claude, path)) agents.push('claude');
  if (found(options.pi, path)) agents.push('pi');
  return agents;
};
