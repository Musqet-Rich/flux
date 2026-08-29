import type { AgentAdapter } from '../create-session-supervisor.ts';
import type { Pending } from './map-claude-line.ts';
import { mapClaudeLine } from './map-claude-line.ts';
import { parseStreamLine } from './parse-stream-line.ts';

// The read side of the Claude adapter as the supervisor sees it (ADR 0007): parse, then map,
// with the in-flight tool names kept across lines.

export const claudeAdapter = (cwd: string): AgentAdapter => {
  const pending: Pending = { tools: new Map() };
  return {
    mapLine: (line) => {
      const parsed = parseStreamLine(line);
      return parsed === null ? null : mapClaudeLine(parsed, pending, cwd);
    },
    reset: () => {
      pending.tools.clear();
    },
  };
};
