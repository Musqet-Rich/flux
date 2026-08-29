import type { EventInput } from '../create-event-log.ts';
import type { Mapped } from '../create-session-supervisor.ts';
import type { PiAssistantMessage, PiLine, PiUsage } from './parse-pi-line.ts';
import { piToolSummary } from './pi-tool-summary.ts';

// Pure mapping from a parsed pi line to Flux events (the pi table in architecture.md § Adapter).
// pi reports usage per assistant message and never a per-run total, so `PiPending` sums the
// messages of one agent run (agent_start … agent_settled) into the single `turn.ended` Flux
// logs, the way Claude's `result` line does in one go.

export interface PiPending {
  tools: Map<string, string>;
  run: {
    usage: PiUsage;
    messages: number;
    stopReason: string | undefined;
  };
}

const maxOutputBytes = 64 * 1024;

const freshRun = (): PiPending['run'] => ({
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
  messages: 0,
  stopReason: undefined,
});

// The cap is 64 KiB of UTF-8 (protocol.md § 5), so it is measured in bytes, not characters.
const capOutput = (text: string): string => {
  const bytes = Buffer.byteLength(text);
  if (bytes <= maxOutputBytes) return text;
  const head = Buffer.from(text).subarray(0, maxOutputBytes).toString();
  return `${head}\n[truncated ${bytes - maxOutputBytes} bytes]`;
};

const add = (total: PiUsage, usage: PiUsage): void => {
  total.input += usage.input;
  total.output += usage.output;
  total.cacheRead += usage.cacheRead;
  total.cacheWrite += usage.cacheWrite;
  total.costUsd += usage.costUsd;
};

const assistant = (message: PiAssistantMessage, pending: PiPending): Mapped => {
  const events: EventInput[] = [];
  for (const block of message.blocks) {
    if (block.text !== '') events.push({ type: 'msg.assistant', payload: { text: block.text } });
  }
  // A failed call (bad model, no credit, …) has no text; the error is what the operator needs.
  if (message.errorMessage !== undefined && message.stopReason === 'error') {
    events.push({ type: 'raw', payload: { agent: 'pi', data: { error: message.errorMessage } } });
  }
  const { run } = pending;
  run.messages += 1;
  run.stopReason = message.stopReason;
  if (message.usage !== undefined) add(run.usage, message.usage);
  return { events };
};

const toolStart = (
  line: PiLine & { kind: 'tool_start' },
  pending: PiPending,
  cwd: string,
): Mapped => {
  pending.tools.set(line.toolId, line.name);
  return {
    events: [
      {
        type: 'tool.start',
        payload: {
          toolId: line.toolId,
          name: line.name,
          input: line.args,
          summary: piToolSummary.start(line.name, line.args, cwd),
        },
      },
    ],
  };
};

const toolEnd = (line: PiLine & { kind: 'tool_end' }, pending: PiPending): Mapped => {
  pending.tools.delete(line.toolId);
  const ok = !line.isError;
  return {
    events: [
      {
        type: 'tool.end',
        payload: {
          toolId: line.toolId,
          ok,
          summary: piToolSummary.end(line.name, ok, line.result),
          output: capOutput(piToolSummary.output(line.result)),
        },
      },
    ],
    filesChanged: ok && piToolSummary.writes(line.name),
  };
};

const settled = (pending: PiPending): Mapped => {
  const { run } = pending;
  const { usage } = run;
  const mapped: Mapped = {
    turnEnded: true,
    events: [
      {
        type: 'turn.ended',
        payload: {
          costUsd: usage.costUsd,
          numTurns: run.messages,
          ...(run.stopReason === undefined ? {} : { stopReason: run.stopReason }),
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
  pending.run = freshRun();
  return mapped;
};

// An if-chain rather than a switch, for the same reason as map-claude-line.ts.
export const mapPiLine = (line: PiLine, pending: PiPending, cwd: string): Mapped => {
  if (line.kind === 'agent_start') return { events: [], running: true };
  if (line.kind === 'delta') return { events: [], delta: line.text };
  if (line.kind === 'assistant') return assistant(line.message, pending);
  if (line.kind === 'tool_start') return toolStart(line, pending, cwd);
  if (line.kind === 'tool_end') return toolEnd(line, pending);
  if (line.kind === 'agent_settled') return settled(pending);
  if (line.kind === 'response_error') {
    return {
      events: [
        {
          type: 'raw',
          payload: { agent: 'pi', data: { command: line.command, error: line.error } },
        },
      ],
    };
  }
  if (line.kind === 'notice') {
    const data = { event: line.event, ...line.fields };
    return { events: [{ type: 'raw', payload: { agent: 'pi', data } }] };
  }
  if (line.kind === 'ignored' || line.kind === 'user') return { events: [] };
  return { events: [{ type: 'raw', payload: { agent: 'pi', data: line.data } }] };
};
