import { guards } from '@flux/protocol';

// One line of `claude -p --output-format stream-json --verbose --include-partial-messages`
// narrowed to the parts Flux reads (architecture.md § Adapter, verified against 2.1.251 with
// the fixtures under test/fixtures/claude). Anything unrecognised becomes `other` and is
// logged as a `raw` event, never dropped.

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: unknown;
  is_error?: boolean;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface RateWindowInfo {
  utilization: number;
  resetsAt: number;
}

export type ClaudeLine =
  | { kind: 'init'; sessionId: string; model: string }
  | { kind: 'status'; status: string }
  | { kind: 'delta'; text: string }
  | { kind: 'assistant'; blocks: (TextBlock | ToolUseBlock)[] }
  | { kind: 'tool_result'; blocks: ToolResultBlock[]; toolUseResult: unknown }
  | {
      kind: 'result';
      isError: boolean;
      costUsd?: number;
      durationMs?: number;
      numTurns?: number;
      stopReason?: string;
      usage?: Usage;
    }
  | { kind: 'rate_limit'; windows: Record<string, RateWindowInfo> }
  | { kind: 'other'; data: unknown };

const { isString, isNumber, isInteger, isRecord, isArrayOf, isBoolean, isOptional } = guards;

const isTextBlock = (v: unknown): v is TextBlock =>
  isRecord(v) && v['type'] === 'text' && isString(v['text']);

const isToolUseBlock = (v: unknown): v is ToolUseBlock =>
  isRecord(v) &&
  v['type'] === 'tool_use' &&
  isString(v['id']) &&
  isString(v['name']) &&
  'input' in v;

const isToolResultBlock = (v: unknown): v is ToolResultBlock =>
  isRecord(v) &&
  v['type'] === 'tool_result' &&
  isString(v['tool_use_id']) &&
  'content' in v &&
  isOptional(v['is_error'], isBoolean);

const isUsage = (v: unknown): v is Usage =>
  isRecord(v) &&
  isInteger(v['input_tokens']) &&
  isInteger(v['output_tokens']) &&
  isInteger(v['cache_read_input_tokens']) &&
  isInteger(v['cache_creation_input_tokens']);

const isRateWindowInfo = (v: unknown): v is RateWindowInfo =>
  isRecord(v) && isNumber(v['utilization']) && isNumber(v['resetsAt']);

// Blocks are rebuilt with only the fields Flux reads; the agent adds others (`caller`, …).
const assistantBlocks = (content: unknown[]): (TextBlock | ToolUseBlock)[] => {
  const blocks: (TextBlock | ToolUseBlock)[] = [];
  for (const block of content) {
    if (isTextBlock(block)) blocks.push({ type: 'text', text: block.text });
    else if (isToolUseBlock(block)) {
      blocks.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
    }
  }
  return blocks;
};

const toolResultBlock = (block: ToolResultBlock): ToolResultBlock => ({
  type: 'tool_result',
  tool_use_id: block.tool_use_id,
  content: block.content,
  ...(block.is_error === undefined ? {} : { is_error: block.is_error }),
});

const contentOf = (line: Record<string, unknown>): unknown[] => {
  const message = line['message'];
  return isRecord(message) && Array.isArray(message['content']) ? message['content'] : [];
};

const system = (line: Record<string, unknown>): ClaudeLine => {
  if (line['subtype'] === 'init' && isString(line['session_id'])) {
    return {
      kind: 'init',
      sessionId: line['session_id'],
      model: isString(line['model']) ? line['model'] : '',
    };
  }
  if (line['subtype'] === 'status' && isString(line['status'])) {
    return { kind: 'status', status: line['status'] };
  }
  return { kind: 'other', data: line };
};

const streamEvent = (line: Record<string, unknown>): ClaudeLine => {
  const event = line['event'];
  if (isRecord(event) && event['type'] === 'content_block_delta') {
    const delta = event['delta'];
    if (isRecord(delta) && delta['type'] === 'text_delta' && isString(delta['text'])) {
      return { kind: 'delta', text: delta['text'] };
    }
  }
  return { kind: 'other', data: line };
};

const result = (line: Record<string, unknown>): ClaudeLine => {
  const usage = line['usage'];
  return {
    kind: 'result',
    isError: line['is_error'] === true,
    ...(isNumber(line['total_cost_usd']) ? { costUsd: line['total_cost_usd'] } : {}),
    ...(isInteger(line['duration_ms']) ? { durationMs: line['duration_ms'] } : {}),
    ...(isInteger(line['num_turns']) ? { numTurns: line['num_turns'] } : {}),
    ...(isString(line['stop_reason']) ? { stopReason: line['stop_reason'] } : {}),
    ...(isUsage(usage) ? { usage } : {}),
  };
};

const rateLimit = (line: Record<string, unknown>): ClaudeLine => {
  const info = line['rate_limit_info'];
  const unified = isRecord(info) ? info['unifiedWindows'] : undefined;
  if (!isRecord(unified)) return { kind: 'other', data: line };
  const windows: Record<string, RateWindowInfo> = {};
  for (const [name, value] of Object.entries(unified)) {
    if (isRateWindowInfo(value)) windows[name] = value;
  }
  return { kind: 'rate_limit', windows };
};

export const parseStreamLine = (text: string): ClaudeLine | null => {
  let line: unknown;
  try {
    line = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(line)) return null;
  switch (line['type']) {
    case 'system':
      return system(line);
    case 'stream_event':
      return streamEvent(line);
    case 'assistant':
      return { kind: 'assistant', blocks: assistantBlocks(contentOf(line)) };
    case 'user': {
      const blocks = contentOf(line);
      if (blocks.length === 0 || !isArrayOf(blocks, isToolResultBlock)) {
        return { kind: 'other', data: line };
      }
      return {
        kind: 'tool_result',
        blocks: blocks.map((b) => toolResultBlock(b)),
        toolUseResult: line['tool_use_result'],
      };
    }
    case 'result':
      return result(line);
    case 'rate_limit_event':
      return rateLimit(line);
    default:
      return { kind: 'other', data: line };
  }
};
