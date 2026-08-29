import type { RateWindow } from '@flux/protocol';

import type { EventInput } from '../create-event-log.ts';
import type { Mapped } from '../create-session-supervisor.ts';
import type { ClaudeLine } from './parse-stream-line.ts';
import { toolSummary } from './tool-summary.ts';

// Pure mapping from a parsed Claude line to Flux events (the table in architecture.md § Adapter).
// Session lifecycle (created, idle after result) is the supervisor's business; this only
// translates what the agent said. The supervisor keeps `Pending` across lines so tool.end can
// name the tool and know whether it wrote files.

export interface Pending {
  tools: Map<string, string>;
}

const maxOutputBytes = 64 * 1024;

// The cap is 64 KiB of UTF-8 (protocol.md § 5), so it is measured in bytes, not characters.
const capOutput = (content: unknown): unknown => {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  if (text === undefined) return content;
  const bytes = Buffer.byteLength(text);
  if (bytes <= maxOutputBytes) return content;
  const head = Buffer.from(text).subarray(0, maxOutputBytes).toString();
  return `${head}\n[truncated ${bytes - maxOutputBytes} bytes]`;
};

const rateWindows = (windows: Record<string, { utilization: number; resetsAt: number }>) =>
  Object.entries(windows).map(([name, w]): RateWindow => ({
    name,
    utilisation: Math.min(1, Math.max(0, w.utilization)),
    resetsAt: new Date(w.resetsAt * 1000).toISOString(),
  }));

const assistant = (
  line: ClaudeLine & { kind: 'assistant' },
  pending: Pending,
  cwd: string,
): Mapped => {
  const events: EventInput[] = [];
  for (const block of line.blocks) {
    if (block.type === 'text') {
      if (block.text !== '') events.push({ type: 'msg.assistant', payload: { text: block.text } });
    } else {
      pending.tools.set(block.id, block.name);
      events.push({
        type: 'tool.start',
        payload: {
          toolId: block.id,
          name: block.name,
          input: block.input,
          summary: toolSummary.start(block.name, block.input, cwd),
        },
      });
    }
  }
  return { events };
};

const toolResult = (line: ClaudeLine & { kind: 'tool_result' }, pending: Pending): Mapped => {
  const events: EventInput[] = [];
  let filesChanged = false;
  for (const block of line.blocks) {
    const name = pending.tools.get(block.tool_use_id) ?? 'unknown';
    pending.tools.delete(block.tool_use_id);
    const ok = block.is_error !== true;
    if (ok && toolSummary.writes(name)) filesChanged = true;
    events.push({
      type: 'tool.end',
      payload: {
        toolId: block.tool_use_id,
        ok,
        summary: toolSummary.end(name, ok, line.toolUseResult),
        output: capOutput(block.content),
      },
    });
  }
  return { events, filesChanged };
};

const result = (line: ClaudeLine & { kind: 'result' }): Mapped => ({
  turnEnded: true,
  events: [
    {
      type: 'turn.ended',
      payload: {
        ...(line.costUsd === undefined ? {} : { costUsd: line.costUsd }),
        ...(line.durationMs === undefined ? {} : { durationMs: line.durationMs }),
        ...(line.numTurns === undefined ? {} : { numTurns: line.numTurns }),
        ...(line.stopReason === undefined ? {} : { stopReason: line.stopReason }),
        ...(line.usage === undefined
          ? {}
          : {
              usage: {
                input: line.usage.input_tokens,
                output: line.usage.output_tokens,
                cacheRead: line.usage.cache_read_input_tokens,
                cacheWrite: line.usage.cache_creation_input_tokens,
              },
            }),
      },
    },
  ],
});

// An if-chain rather than a switch: the lint set wants a default branch and an exhaustive
// switch at once, and a chain satisfies both with the `other` case as the final return.
export const mapClaudeLine = (line: ClaudeLine, pending: Pending, cwd: string): Mapped => {
  if (line.kind === 'init') return { events: [], agentSessionId: line.sessionId };
  if (line.kind === 'status') return { events: [], running: line.status === 'requesting' };
  if (line.kind === 'delta') return { events: [], delta: line.text };
  if (line.kind === 'assistant') return assistant(line, pending, cwd);
  if (line.kind === 'tool_result') return toolResult(line, pending);
  if (line.kind === 'result') return result(line);
  if (line.kind === 'rate_limit') {
    return { events: [{ type: 'rate_limit', payload: { windows: rateWindows(line.windows) } }] };
  }
  return { events: [{ type: 'raw', payload: { agent: 'claude', data: line.data } }] };
};
