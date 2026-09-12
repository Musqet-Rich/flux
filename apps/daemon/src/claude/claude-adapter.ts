import type { AgentAdapter, Mapped, RunningSpec } from '../create-session-supervisor.ts';
import type { Pending } from './map-claude-line.ts';
import { mapClaudeLine } from './map-claude-line.ts';
import type { ClaudeLine } from './parse-stream-line.ts';
import { parseStreamLine } from './parse-stream-line.ts';
import { readTranscriptEffort } from './read-transcript-effort.ts';
import { transcriptPath } from './transcript-path.ts';

// The read side of the Claude adapter as the supervisor sees it (ADR 0007): parse, then map,
// with the in-flight tool names kept across lines. The thinking indicator is throttled here,
// where time exists, so the mapper stays pure: a start or stop always goes through, a token
// count only after 500 ms or 100 tokens since the last one sent. The running spec is completed
// here too, where the file system exists: the mapper names the model, and the effort comes
// from the transcript (read-transcript-effort.ts) at each turn's end, the one moment this
// process's own assistant line is certainly written; the model restated before that carries
// the effort last read, or none, which the supervisor takes as unknown rather than as a change.

export interface ClaudeAdapterOptions {
  // The agent's config directory, where it keeps its transcripts (the daemon's `claudeDir`; a
  // scratch directory in tests, so no test reads the developer's own).
  configDir: string;
  now?: () => number;
  // The effort the agent with this session id runs at, or undefined when it cannot be known;
  // the transcript reader by default, replaced in tests.
  effort?: (cwd: string, agentSessionId: string) => string | undefined;
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

// What the agent has said about itself so far: `init` names its transcript (the cwd it slugs
// and its session id), `init` and `message_start` name the model, the transcript the effort.
interface Known {
  transcript: { cwd: string; agentSessionId: string } | null;
  model: string | null;
  effort: string | undefined;
}

const forget = (known: Known): void => {
  known.transcript = null;
  known.model = null;
  known.effort = undefined;
};

const transcriptEffort =
  (configDir: string) =>
  (cwd: string, agentSessionId: string): string | undefined =>
    readTranscriptEffort(transcriptPath(cwd, agentSessionId, configDir));

// The spec rides on the lines that name the model and on the turn's end; the supervisor drops
// a restatement that changed nothing.
const withSpec = (
  mapped: Mapped,
  parsed: ClaudeLine,
  known: Known,
  effort: (cwd: string, agentSessionId: string) => string | undefined,
): Mapped => {
  if (parsed.kind === 'init' && parsed.cwd !== '') {
    known.transcript = { cwd: parsed.cwd, agentSessionId: parsed.sessionId };
  }
  // A model named that differs from the one on record (a `/model` mid-session) takes the
  // effort with it: the level read was that model's, and the new one may have no levels at all.
  if (mapped.spec !== undefined && mapped.spec.model !== known.model) {
    known.model = mapped.spec.model;
    known.effort = undefined;
  }
  if (mapped.spec === undefined && mapped.turnEnded !== true) return mapped;
  if (known.model === null) return mapped;
  if (mapped.turnEnded === true && known.transcript !== null) {
    known.effort = effort(known.transcript.cwd, known.transcript.agentSessionId);
  }
  const spec: RunningSpec = {
    model: known.model,
    ...(known.effort === undefined ? {} : { effort: known.effort }),
  };
  return { ...mapped, spec };
};

export const claudeAdapter = (cwd: string, options: ClaudeAdapterOptions): AgentAdapter => {
  const now = options.now ?? (() => Date.now());
  const effort = options.effort ?? transcriptEffort(options.configDir);
  const pending: Pending = { tools: new Map(), thinking: null, agents: new Map() };
  const last: Last = { at: Number.NEGATIVE_INFINITY, tokens: 0 };
  const known: Known = { transcript: null, model: null, effort: undefined };
  return {
    mapLine: (line) => {
      const parsed = parseStreamLine(line);
      if (parsed === null) return null;
      const mapped = throttle(mapClaudeLine(parsed, pending, cwd), last, now());
      return withSpec(mapped, parsed, known, effort);
    },
    reset: () => {
      pending.tools.clear();
      pending.agents.clear();
      pending.thinking = null;
      delete pending.compactResult;
      forget(known);
    },
  };
};
