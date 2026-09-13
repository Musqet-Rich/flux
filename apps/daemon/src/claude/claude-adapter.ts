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
// process's own assistant line is certainly written, or from the agent's confirmation of the
// operator's `/effort` (ADR 0031); the model restated before that carries the effort last
// known, or none, which the supervisor takes as unknown rather than as a change.

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
// and its session id), `init` and `message_start` name the model, the transcript the effort,
// or the agent's confirmation of the operator's `/effort` (ADR 0031).
interface Known {
  transcript: { cwd: string; agentSessionId: string } | null;
  model: string | null;
  effort: string | undefined;
  // The effort is the operator's word, not the transcript's: `/effort` writes no assistant line,
  // nor does any other local command, so a turn's end reads nothing while this holds. Cleared
  // when the agent next completes a message, the moment the line a read wants is written; a
  // call that errors or is cut short before one leaves the word standing.
  told: boolean;
}

const forget = (known: Known): void => {
  known.transcript = null;
  known.model = null;
  known.effort = undefined;
  known.told = false;
};

const transcriptEffort =
  (configDir: string) =>
  (cwd: string, agentSessionId: string): string | undefined =>
    readTranscriptEffort(transcriptPath(cwd, agentSessionId, configDir));

// The levels `--effort` takes (`claude --help`, 2.1.270). `/effort` takes two more, `ultracode`
// and `auto`, that the flag refuses, so one of those runs in this process only, shown on the
// chip, and the record stays as it was: kept, it would fail the next spawn.
const flagLevels = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

// The operator's `/effort <level>`, confirmed by the agent (ADR 0031): the level running from
// here, without a transcript read (the local command writes no assistant line, so the read
// would still find the old one). A subagent has no slash commands; were one to print the line,
// it would not be the operator's word. The guard matters: `underParent` (map-claude-line.ts)
// strips a subagent line's spec, but `chosen` is added after mapping, here.
const heard = (parsed: ClaudeLine): string | undefined =>
  parsed.kind === 'effort_set' && parsed.parent === undefined ? parsed.effort : undefined;

// The level the record keeps for the next spawn: one the flag takes.
const kept = (level: string | undefined): { chosen?: { effort: string } } =>
  level !== undefined && flagLevels.has(level) ? { chosen: { effort: level } } : {};

// The newest assistant line in the transcript, unless the operator's word stands. Nothing is
// read before a model is named: the line found would be the previous process's.
const readEffort = (
  known: Known,
  effort: (cwd: string, agentSessionId: string) => string | undefined,
): void => {
  if (known.told || known.model === null || known.transcript === null) return;
  known.effort = effort(known.transcript.cwd, known.transcript.agentSessionId);
};

// The spec rides on the lines that name the model, on the operator's `/effort` and on the turn's
// end; the supervisor drops a restatement that changed nothing.
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
  // effort with it, the operator's word included: the level known was that model's, and the
  // new one may have no levels at all. The first model named keeps what the operator may
  // already have said.
  if (mapped.spec !== undefined) {
    if (known.model !== null && mapped.spec.model !== known.model) {
      known.effort = undefined;
      known.told = false;
    }
    known.model = mapped.spec.model;
  }
  // A reply of the model's own is a line written; a local command's is not.
  if (parsed.kind === 'assistant' && parsed.parent === undefined && parsed.synthetic !== true) {
    known.told = false;
  }
  const level = heard(parsed);
  if (level !== undefined) {
    known.effort = level;
    known.told = true;
  }
  if (mapped.turnEnded === true) readEffort(known, effort);
  const says = level !== undefined || mapped.spec !== undefined || mapped.turnEnded === true;
  if (!says || known.model === null) return { ...mapped, ...kept(level) };
  const spec: RunningSpec = {
    model: known.model,
    ...(known.effort === undefined ? {} : { effort: known.effort }),
  };
  return { ...mapped, ...kept(level), spec };
};

export const claudeAdapter = (cwd: string, options: ClaudeAdapterOptions): AgentAdapter => {
  const now = options.now ?? (() => Date.now());
  const effort = options.effort ?? transcriptEffort(options.configDir);
  const pending: Pending = { tools: new Map(), thinking: null, agents: new Map() };
  const last: Last = { at: Number.NEGATIVE_INFINITY, tokens: 0 };
  const known: Known = { transcript: null, model: null, effort: undefined, told: false };
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
