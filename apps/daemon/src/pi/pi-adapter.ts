import type { AgentAdapter } from '../create-session-supervisor.ts';
import type { PiPending } from './map-pi-line.ts';
import { mapPiLine } from './map-pi-line.ts';
import { parsePiLine } from './parse-pi-line.ts';

// The read side of the pi adapter as the supervisor sees it: one stateful line mapper per
// session, holding the tool names and usage sums that outlive a single line.

const pending = (): PiPending => ({
  tools: new Map(),
  run: {
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
    messages: 0,
    stopReason: undefined,
  },
});

export const piAdapter = (cwd: string): AgentAdapter => {
  let state = pending();
  return {
    mapLine: (line) => {
      const parsed = parsePiLine(line);
      return parsed === null ? null : mapPiLine(parsed, state, cwd);
    },
    reset: () => {
      state = pending();
    },
  };
};
