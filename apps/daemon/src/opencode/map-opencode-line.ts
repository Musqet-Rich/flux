import type { EventInput } from '../create-event-log.ts';
import type { Mapped } from '../create-session-supervisor.ts';
import type { OpencodeLine, OpencodeToolCall } from './parse-opencode-line.ts';
import { opencodeToolSummary } from './opencode-tool-summary.ts';

// Pure mapping from a parsed opencode line to Flux events (ADR 0027 § 2). opencode reports usage
// and real cost per step (`step_finish`); a turn is one or more steps, so `OpencodePending` sums
// the steps of one run into the single `turn.ended` Flux logs on the final step (`reason:"stop"`).
// Intermediate steps (`reason:"tool-calls"`) accumulate and do not end the turn.

export interface OpencodeUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
}

export interface OpencodePending {
  usage: OpencodeUsage;
  steps: number;
}

const maxOutputBytes = 64 * 1024;

// The cap is 64 KiB of UTF-8 (protocol.md § 5), so it is measured in bytes, not characters.
const capOutput = (text: string): string => {
  const bytes = Buffer.byteLength(text);
  if (bytes <= maxOutputBytes) return text;
  const head = Buffer.from(text).subarray(0, maxOutputBytes).toString();
  return `${head}\n[truncated ${bytes - maxOutputBytes} bytes]`;
};

const tool = (call: OpencodeToolCall, cwd: string): Mapped => {
  const events: EventInput[] = [
    {
      type: 'tool.start',
      payload: {
        toolId: call.callId,
        name: call.tool,
        input: call.input,
        summary: opencodeToolSummary.start(call.tool, call.input, cwd),
      },
    },
    {
      type: 'tool.end',
      payload: {
        toolId: call.callId,
        ok: call.ok,
        summary: opencodeToolSummary.end(call.tool, call.ok, call.output),
        output: capOutput(call.output),
      },
    },
  ];
  return { events, filesChanged: call.ok && opencodeToolSummary.writes(call.tool) };
};

// The next turn is a fresh run of steps; the sums are reset in place after a turn ends so a
// session's second turn does not inherit the first's usage or cost.
const resetPending = (pending: OpencodePending): void => {
  pending.usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };
  pending.steps = 0;
};

const stepFinish = (
  line: OpencodeLine & { kind: 'step_finish' },
  pending: OpencodePending,
): Mapped => {
  const { usage } = pending;
  usage.input += line.tokens.input;
  usage.output += line.tokens.output;
  usage.cacheWrite += line.tokens.cacheWrite;
  usage.cacheRead += line.tokens.cacheRead;
  usage.costUsd += line.cost;
  pending.steps += 1;
  // Only the final step ends the turn; a `tool-calls` step is a mid-turn boundary that keeps
  // the run going, so it accumulates and emits nothing.
  if (line.reason !== 'stop') return { events: [] };
  const mapped: Mapped = {
    turnEnded: true,
    events: [
      {
        type: 'turn.ended',
        payload: {
          costUsd: usage.costUsd,
          numTurns: pending.steps,
          stopReason: line.reason,
          usage: {
            input: usage.input,
            output: usage.output,
            cacheRead: usage.cacheRead,
            cacheWrite: usage.cacheWrite,
          },
        },
      },
    ],
  };
  resetPending(pending);
  return mapped;
};

// An if-chain rather than a switch, for the same reason as map-claude-line.ts / map-pi-line.ts.
export const mapOpencodeLine = (
  line: OpencodeLine,
  pending: OpencodePending,
  cwd: string,
): Mapped => {
  if (line.kind === 'step_start') {
    return { events: [], running: true, agentSessionId: line.sessionId };
  }
  if (line.kind === 'text') {
    return line.text === ''
      ? { events: [] }
      : { events: [{ type: 'msg.assistant', payload: { text: line.text } }] };
  }
  if (line.kind === 'tool') return tool(line.call, cwd);
  if (line.kind === 'step_finish') return stepFinish(line, pending);
  if (line.kind === 'reasoning') return { events: [], thinking: { active: true } };
  if (line.kind === 'error') {
    return {
      events: [{ type: 'raw', payload: { agent: 'opencode', data: { error: line.message } } }],
    };
  }
  if (line.kind === 'ignored') return { events: [] };
  return { events: [{ type: 'raw', payload: { agent: 'opencode', data: line.data } }] };
};
