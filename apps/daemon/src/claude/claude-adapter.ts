import type { AgentAdapter, Mapped } from '../create-session-supervisor.ts';
import type { Pending } from './map-claude-line.ts';
import { mapClaudeLine } from './map-claude-line.ts';
import { parseStreamLine } from './parse-stream-line.ts';

// The read side of the Claude adapter as the supervisor sees it (ADR 0007): parse, then map,
// with the in-flight tool names kept across lines. The thinking indicator is throttled here,
// where time exists, so the mapper stays pure: a start or stop always goes through, a token
// count only after 500 ms or 100 tokens since the last one sent.

export interface ClaudeAdapterOptions {
  now?: () => number;
}

const minIntervalMs = 500;
const minTokenStep = 100;

interface Last {
  at: number;
  tokens: number;
}

const throttle = (mapped: Mapped, last: Last, now: number): Mapped => {
  const { thinking } = mapped;
  if (thinking === undefined) return mapped;
  const tokens = thinking.estimatedTokens ?? 0;
  const due =
    thinking.estimatedTokens === undefined ||
    now - last.at >= minIntervalMs ||
    tokens - last.tokens >= minTokenStep;
  if (!due) {
    const { thinking: _dropped, ...rest } = mapped;
    return rest;
  }
  last.at = now;
  last.tokens = thinking.active ? tokens : 0;
  return mapped;
};

export const claudeAdapter = (cwd: string, options: ClaudeAdapterOptions = {}): AgentAdapter => {
  const now = options.now ?? (() => Date.now());
  const pending: Pending = { tools: new Map(), thinking: null, agents: new Map() };
  const last: Last = { at: Number.NEGATIVE_INFINITY, tokens: 0 };
  return {
    mapLine: (line) => {
      const parsed = parseStreamLine(line);
      return parsed === null ? null : throttle(mapClaudeLine(parsed, pending, cwd), last, now());
    },
    reset: () => {
      pending.tools.clear();
      pending.agents.clear();
      pending.thinking = null;
      delete pending.compactResult;
    },
  };
};
