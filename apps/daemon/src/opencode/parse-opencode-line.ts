import { guards } from '@flux/protocol';

// One line of `opencode run --format json` stdout narrowed to what Flux reads (ADR 0027 § 2,
// verified against the fixtures under test/fixtures/opencode). Every event is self-contained
// NDJSON — a `type` and a `part` — so the read side keeps far less cross-line state than claude
// or pi. Lifecycle chatter Flux does not surface is `ignored`; anything unrecognised is `other`
// and logged as `raw`, never dropped.

export interface OpencodeTokens {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

// A whole tool call in one event (unlike claude's start/delta/result across lines): the args are
// `state.input`, the result `state.output`, and `state.status` says whether it succeeded.
export interface OpencodeToolCall {
  tool: string;
  callId: string;
  ok: boolean;
  input: unknown;
  output: string;
}

export type OpencodeLine =
  | { kind: 'step_start'; sessionId: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; call: OpencodeToolCall }
  | { kind: 'step_finish'; reason: string; tokens: OpencodeTokens; cost: number }
  | { kind: 'reasoning' }
  | { kind: 'error'; message: string }
  | { kind: 'ignored' }
  | { kind: 'other'; data: unknown };

const { isString, isNumber, isInteger, isRecord } = guards;

const tokensOf = (value: unknown): OpencodeTokens => {
  if (!isRecord(value)) return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  const cache = isRecord(value['cache']) ? value['cache'] : {};
  return {
    input: isInteger(value['input']) ? value['input'] : 0,
    output: isInteger(value['output']) ? value['output'] : 0,
    cacheWrite: isInteger(cache['write']) ? cache['write'] : 0,
    cacheRead: isInteger(cache['read']) ? cache['read'] : 0,
  };
};

const toolCall = (part: Record<string, unknown>): OpencodeLine => {
  const state = isRecord(part['state']) ? part['state'] : {};
  if (!isString(part['tool']) || !isString(part['callID'])) return { kind: 'other', data: part };
  return {
    kind: 'tool',
    call: {
      tool: part['tool'],
      callId: part['callID'],
      ok: state['status'] === 'completed',
      input: state['input'],
      output: isString(state['output']) ? state['output'] : '',
    },
  };
};

const stepFinish = (part: Record<string, unknown>): OpencodeLine => ({
  kind: 'step_finish',
  reason: isString(part['reason']) ? part['reason'] : 'stop',
  tokens: tokensOf(part['tokens']),
  cost: isNumber(part['cost']) ? part['cost'] : 0,
});

const errorLine = (part: Record<string, unknown>, line: Record<string, unknown>): OpencodeLine => {
  const message = isString(part['error'])
    ? part['error']
    : isString(line['error'])
      ? line['error']
      : 'opencode error';
  return { kind: 'error', message };
};

export const parseOpencodeLine = (text: string): OpencodeLine | null => {
  let line: unknown;
  try {
    line = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(line) || !isString(line['type'])) return null;
  const part = isRecord(line['part']) ? line['part'] : {};
  switch (line['type']) {
    case 'step_start':
      return isString(line['sessionID'])
        ? { kind: 'step_start', sessionId: line['sessionID'] }
        : { kind: 'ignored' };
    case 'text':
      return isString(part['text']) ? { kind: 'text', text: part['text'] } : { kind: 'ignored' };
    case 'tool_use':
      return toolCall(part);
    case 'step_finish':
      return stepFinish(part);
    case 'reasoning':
      return { kind: 'reasoning' };
    case 'error':
      return errorLine(part, line);
    default:
      return { kind: 'other', data: line };
  }
};
