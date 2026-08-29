import { guards } from '@flux/protocol';

// One line of `claude -p --output-format stream-json --verbose --include-partial-messages`
// narrowed to the parts Flux reads (architecture.md § Adapter, verified against 2.1.251 with
// the fixtures under test/fixtures/claude). Anything unrecognised becomes `other` and is
// logged as a `raw` event, never dropped. A line a subagent produced carries the Agent call's
// `parent_tool_use_id`; it is kept as `parent` on whatever the line parses to (fixture
// session-subagents), and is absent on every top-level line.

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

type ClaudeLineBody =
  | { kind: 'init'; sessionId: string; model: string }
  | { kind: 'status'; status: string }
  | { kind: 'delta'; text: string }
  | { kind: 'assistant'; blocks: (TextBlock | ToolUseBlock)[] }
  | { kind: 'tool_result'; blocks: ToolResultBlock[]; toolUseResult: unknown }
  // A subagent's prompt: the `user` line with text content that opens its transcript.
  | { kind: 'user_text'; text: string }
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
  // The prompt size of one model call: `message_start.usage` summed (architecture.md § Adapter).
  | { kind: 'context'; tokens: number; model: string }
  // A thinking block opening, and any block closing (the mapper knows which index is thinking).
  | { kind: 'thinking_start'; index: number }
  | { kind: 'block_stop'; index: number; data: unknown }
  | { kind: 'thinking_tokens'; estimatedTokens: number }
  | {
      kind: 'task_started';
      taskId: string;
      toolUseId: string;
      description: string;
      background: boolean;
      agentType?: string;
    }
  | { kind: 'task_progress'; taskId: string; description: string; tokens?: number }
  | { kind: 'task_ended'; taskId: string; status: string; summary: string; tokens?: number }
  | {
      kind: 'pr_published';
      provider: string;
      url: string;
      repo: string;
      identifier: string;
      action: string;
    }
  | { kind: 'vcs_changed'; vcsKind: string }
  | { kind: 'hook_failed'; hookName: string; hookEvent: string; exitCode?: number; stderr: string }
  | { kind: 'other'; data: unknown };

export type ClaudeLine = ClaudeLineBody & { parent?: string };

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

// The system signals seen dogfooding 2.1.251 (fixtures/claude/session-thinking-tasks-pr): a
// task around a tool call, a PR the agent opened itself, a push, a hook that did not succeed.
const totalTokens = (line: Record<string, unknown>): { tokens?: number } => {
  const usage = line['usage'];
  const tokens = isRecord(usage) ? usage['total_tokens'] : undefined;
  return isInteger(tokens) ? { tokens } : {};
};

const systemSignal = (line: Record<string, unknown>): ClaudeLine | null => {
  const s = line['subtype'];
  const str = (key: string): string => (isString(line[key]) ? line[key] : '');
  if (s === 'thinking_tokens' && isInteger(line['estimated_tokens'])) {
    return { kind: 'thinking_tokens', estimatedTokens: line['estimated_tokens'] };
  }
  if (s === 'task_started' && isString(line['task_id']) && isString(line['tool_use_id'])) {
    return {
      kind: 'task_started',
      taskId: line['task_id'],
      toolUseId: line['tool_use_id'],
      description: str('description'),
      background: line['is_backgrounded'] === true,
      ...(isString(line['subagent_type']) ? { agentType: line['subagent_type'] } : {}),
    };
  }
  if (s === 'task_progress' && isString(line['task_id'])) {
    const { tokens } = totalTokens(line);
    return {
      kind: 'task_progress',
      taskId: line['task_id'],
      description: str('description'),
      ...(tokens === undefined ? {} : { tokens }),
    };
  }
  if (s === 'task_notification' && isString(line['task_id']) && isString(line['status'])) {
    return {
      kind: 'task_ended',
      taskId: line['task_id'],
      status: line['status'],
      summary: str('summary'),
      ...totalTokens(line),
    };
  }
  if (s === 'code_change_published' && isString(line['url'])) {
    return {
      kind: 'pr_published',
      provider: str('provider'),
      url: line['url'],
      repo: str('repo'),
      identifier: str('identifier'),
      action: str('action'),
    };
  }
  if (s === 'vcs_state_changed' && isString(line['kind'])) {
    return { kind: 'vcs_changed', vcsKind: line['kind'] };
  }
  return null;
};

const hookResponse = (line: Record<string, unknown>): ClaudeLine | null => {
  if (line['subtype'] !== 'hook_response' || line['outcome'] === 'success') return null;
  return {
    kind: 'hook_failed',
    hookName: isString(line['hook_name']) ? line['hook_name'] : '',
    hookEvent: isString(line['hook_event']) ? line['hook_event'] : '',
    ...(isInteger(line['exit_code']) ? { exitCode: line['exit_code'] } : {}),
    stderr: isString(line['stderr']) ? line['stderr'] : '',
  };
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
  return systemSignal(line) ?? hookResponse(line) ?? { kind: 'other', data: line };
};

// The context in use is the whole prompt of this request: the three input token counts on the
// `message_start` usage. `turn.ended.usage` is a per-turn sum and cannot stand in for it.
const messageStart = (event: Record<string, unknown>): ClaudeLine | null => {
  const message = event['message'];
  if (!isRecord(message)) return null;
  const usage = message['usage'];
  if (!isRecord(usage)) return null;
  const input = usage['input_tokens'];
  const cacheCreate = usage['cache_creation_input_tokens'];
  const cacheRead = usage['cache_read_input_tokens'];
  if (!isInteger(input) || !isInteger(cacheCreate) || !isInteger(cacheRead)) return null;
  return {
    kind: 'context',
    tokens: input + cacheCreate + cacheRead,
    model: isString(message['model']) ? message['model'] : '',
  };
};

const streamEvent = (line: Record<string, unknown>): ClaudeLine => {
  const event = line['event'];
  if (!isRecord(event)) return { kind: 'other', data: line };
  if (event['type'] === 'message_start')
    return messageStart(event) ?? { kind: 'other', data: line };
  if (event['type'] === 'content_block_delta') {
    const delta = event['delta'];
    if (isRecord(delta) && delta['type'] === 'text_delta' && isString(delta['text'])) {
      return { kind: 'delta', text: delta['text'] };
    }
  }
  const index = event['index'];
  const block = event['content_block'];
  if (
    event['type'] === 'content_block_start' &&
    isInteger(index) &&
    isRecord(block) &&
    block['type'] === 'thinking'
  ) {
    return { kind: 'thinking_start', index };
  }
  if (event['type'] === 'content_block_stop' && isInteger(index)) {
    return { kind: 'block_stop', index, data: line };
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

// A top-level `user` line with text is nothing Flux sent (the operator's own messages are not
// echoed), so it stays `other`; under a parent it is the subagent's prompt.
const user = (line: Record<string, unknown>, parent: string | undefined): ClaudeLineBody => {
  const blocks = contentOf(line);
  if (blocks.length > 0 && isArrayOf(blocks, isToolResultBlock)) {
    return {
      kind: 'tool_result',
      blocks: blocks.map((b) => toolResultBlock(b)),
      toolUseResult: line['tool_use_result'],
    };
  }
  if (parent !== undefined && blocks.length > 0 && isArrayOf(blocks, isTextBlock)) {
    return { kind: 'user_text', text: blocks.map((b) => b.text).join('\n') };
  }
  return { kind: 'other', data: line };
};

const body = (line: Record<string, unknown>, parent: string | undefined): ClaudeLineBody => {
  switch (line['type']) {
    case 'system':
      return system(line);
    case 'stream_event':
      return streamEvent(line);
    case 'assistant':
      return { kind: 'assistant', blocks: assistantBlocks(contentOf(line)) };
    case 'user':
      return user(line, parent);
    case 'result':
      return result(line);
    case 'rate_limit_event':
      return rateLimit(line);
    default:
      return { kind: 'other', data: line };
  }
};

export const parseStreamLine = (text: string): ClaudeLine | null => {
  let line: unknown;
  try {
    line = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(line)) return null;
  const parent = line['parent_tool_use_id'];
  const parsed = body(line, isString(parent) ? parent : undefined);
  return isString(parent) ? { ...parsed, parent } : parsed;
};
