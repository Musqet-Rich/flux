import type { AgentAdapter } from '../create-session-supervisor.ts';
import type { OpencodePending } from './map-opencode-line.ts';
import { mapOpencodeLine } from './map-opencode-line.ts';
import { parseOpencodeLine } from './parse-opencode-line.ts';

// The read side of the opencode adapter as the supervisor sees it (ADR 0027): one stateful line
// mapper per session, holding the per-run usage and cost sums that outlive a single line.

const pending = (): OpencodePending => ({
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
  steps: 0,
});

export const opencodeAdapter = (cwd: string): AgentAdapter => {
  let state: OpencodePending = pending();
  return {
    mapLine: (line) => {
      const parsed = parseOpencodeLine(line);
      return parsed === null ? null : mapOpencodeLine(parsed, state, cwd);
    },
    reset: () => {
      state = pending();
    },
  };
};
