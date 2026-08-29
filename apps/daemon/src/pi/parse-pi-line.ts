import { guards } from '@flux/protocol';

// One line of `pi --mode rpc` stdout narrowed to what Flux reads (architecture.md § Adapter,
// verified against pi 0.84.4 with the fixtures under test/fixtures/pi). Lifecycle chatter that
// carries nothing for the operator (`turn_start`, user and tool-result `message_end`, …) is
// `ignored`; anything unrecognised is `other` and logged as `raw`, never dropped.

export interface PiUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
}

export interface PiTextBlock {
  type: 'text';
  text: string;
}

export interface PiAssistantMessage {
  blocks: PiTextBlock[];
  stopReason: string;
  // The model id pi reports on the message (the resolved one, e.g. `claude-haiku-4-5-20251001`
  // for the alias `claude-haiku-4-5`); the status bar's context reading is keyed by it.
  model: string;
  errorMessage?: string;
  usage?: PiUsage;
}

export type PiLine =
  | { kind: 'agent_start' }
  | { kind: 'agent_settled' }
  | { kind: 'delta'; text: string }
  | { kind: 'user' }
  | { kind: 'assistant'; message: PiAssistantMessage }
  | { kind: 'tool_start'; toolId: string; name: string; args: unknown }
  | { kind: 'tool_end'; toolId: string; name: string; result: unknown; isError: boolean }
  | { kind: 'response_error'; command: string; error: string }
  // Something the operator should see as state (a retry, a compaction, a broken extension),
  // reduced to its telling fields; the whole payload can be large.
  | { kind: 'notice'; event: string; fields: Record<string, unknown> }
  | { kind: 'ignored' }
  | { kind: 'other'; data: unknown };

const { isString, isNumber, isInteger, isRecord, isBoolean } = guards;

const isUsage = (v: unknown): v is Omit<PiUsage, 'costUsd'> & { cost: unknown } =>
  isRecord(v) &&
  isInteger(v['input']) &&
  isInteger(v['output']) &&
  isInteger(v['cacheRead']) &&
  isInteger(v['cacheWrite']);

const usageOf = (v: unknown): PiUsage | undefined => {
  if (!isUsage(v)) return undefined;
  const cost = isRecord(v.cost) && isNumber(v.cost['total']) ? v.cost['total'] : 0;
  return {
    input: v.input,
    output: v.output,
    cacheRead: v.cacheRead,
    cacheWrite: v.cacheWrite,
    costUsd: cost,
  };
};

const textBlocks = (content: unknown): PiTextBlock[] => {
  if (!Array.isArray(content)) return [];
  const blocks: PiTextBlock[] = [];
  for (const block of content) {
    if (isRecord(block) && block['type'] === 'text' && isString(block['text'])) {
      blocks.push({ type: 'text', text: block['text'] });
    }
  }
  return blocks;
};

// Only the assistant's `message_end` is authoritative (pi's own docs); user and tool-result
// messages are already known to Flux from its own log. Its `timestamp` is when the message
// started, so no duration can be read from the stream and `turn.ended` carries none.
const messageEnd = (line: Record<string, unknown>): PiLine => {
  const message = line['message'];
  if (!isRecord(message)) return { kind: 'other', data: line };
  if (message['role'] === 'user') return { kind: 'user' };
  if (message['role'] !== 'assistant') return { kind: 'ignored' };
  const usage = usageOf(message['usage']);
  return {
    kind: 'assistant',
    message: {
      blocks: textBlocks(message['content']),
      stopReason: isString(message['stopReason']) ? message['stopReason'] : 'stop',
      model: isString(message['model']) ? message['model'] : '',
      ...(isString(message['errorMessage']) ? { errorMessage: message['errorMessage'] } : {}),
      ...(usage === undefined ? {} : { usage }),
    },
  };
};

const messageUpdate = (line: Record<string, unknown>): PiLine => {
  const event = line['assistantMessageEvent'];
  if (isRecord(event) && event['type'] === 'text_delta' && isString(event['delta'])) {
    return { kind: 'delta', text: event['delta'] };
  }
  return { kind: 'ignored' };
};

const toolStart = (line: Record<string, unknown>): PiLine =>
  isString(line['toolCallId']) && isString(line['toolName'])
    ? { kind: 'tool_start', toolId: line['toolCallId'], name: line['toolName'], args: line['args'] }
    : { kind: 'other', data: line };

const toolEnd = (line: Record<string, unknown>): PiLine =>
  isString(line['toolCallId']) && isString(line['toolName'])
    ? {
        kind: 'tool_end',
        toolId: line['toolCallId'],
        name: line['toolName'],
        result: line['result'],
        isError: isBoolean(line['isError']) && line['isError'],
      }
    : { kind: 'other', data: line };

// A failed command is the only response worth logging; a successful one is an acknowledgement.
const response = (line: Record<string, unknown>): PiLine => {
  if (line['success'] === true) return { kind: 'ignored' };
  return {
    kind: 'response_error',
    command: isString(line['command']) ? line['command'] : '',
    error: isString(line['error']) ? line['error'] : 'command failed',
  };
};

const ignored = new Set([
  'turn_start',
  'turn_end',
  'message_start',
  'agent_end',
  'tool_execution_update',
  'queue_update',
  'bash_execution_update',
]);

// Event → the fields worth logging (pi's rpc.md). `extension_ui_request` dialogs are answered
// as cancelled by spawn-pi.ts; they still show up here so the operator knows one happened.
const notices: Record<string, string[]> = {
  auto_retry_start: ['attempt', 'maxAttempts', 'delayMs', 'errorMessage'],
  auto_retry_end: ['success', 'attempt', 'finalError'],
  compaction_start: ['reason'],
  compaction_end: ['reason', 'aborted', 'willRetry', 'errorMessage'],
  summarization_retry_scheduled: ['attempt', 'maxAttempts', 'delayMs', 'errorMessage'],
  extension_error: ['extensionPath', 'event', 'error'],
  hook_error: ['hookPath', 'event', 'error'],
  extension_ui_request: ['method', 'title', 'message'],
};

const notice = (line: Record<string, unknown>, keys: string[]): PiLine => {
  const fields: Record<string, unknown> = {};
  for (const key of keys) if (line[key] !== undefined) fields[key] = line[key];
  return { kind: 'notice', event: isString(line['type']) ? line['type'] : '', fields };
};

export const parsePiLine = (text: string): PiLine | null => {
  let line: unknown;
  try {
    line = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(line) || !isString(line['type'])) return null;
  switch (line['type']) {
    case 'agent_start':
      return { kind: 'agent_start' };
    case 'agent_settled':
      return { kind: 'agent_settled' };
    case 'message_update':
      return messageUpdate(line);
    case 'message_end':
      return messageEnd(line);
    case 'tool_execution_start':
      return toolStart(line);
    case 'tool_execution_end':
      return toolEnd(line);
    case 'response':
      return response(line);
    default: {
      const keys = notices[line['type']];
      if (keys !== undefined) return notice(line, keys);
      return ignored.has(line['type']) ? { kind: 'ignored' } : { kind: 'other', data: line };
    }
  }
};
