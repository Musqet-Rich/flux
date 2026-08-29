import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

import type { PiLine } from './parse-pi-line.ts';
import { parsePiLine } from './parse-pi-line.ts';

// Every fixture under test/fixtures/pi is real `pi --mode rpc` output (see the README there);
// the parser must account for every line of every one of them.

const fixture = (name: string): string[] =>
  readFileSync(
    fileURLToPath(new URL(`../../test/fixtures/pi/${name}.jsonl`, import.meta.url)),
    'utf8',
  )
    .split('\n')
    .filter((line) => line.trim() !== '');

const parseAll = (name: string): PiLine[] =>
  fixture(name).map((line) => {
    const parsed = parsePiLine(line);
    expect(parsed).not.toBeNull();
    return parsed ?? { kind: 'ignored' };
  });

const kinds = (lines: PiLine[]): string[] => lines.map((l) => l.kind);

test('a text reply: start, delta, assistant text with usage, settled', () => {
  const lines = parseAll('text-reply');
  expect(kinds(lines).filter((k) => k !== 'ignored')).toEqual([
    'agent_start',
    'user',
    'delta',
    'delta',
    'assistant',
    'agent_settled',
  ]);
  const deltas = lines.filter((l) => l.kind === 'delta') as { text: string }[];
  expect(deltas.map((d) => d.text).join('')).toBe('pong');
  expect(lines.find((l) => l.kind === 'assistant')).toEqual({
    kind: 'assistant',
    message: {
      blocks: [{ type: 'text', text: 'pong' }],
      stopReason: 'stop',
      usage: {
        input: 3415,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        costUsd: expect.closeTo(0.00344, 6),
      },
    },
  });
});

test('a run with tools: read and bash start and end with their ids, names, args and results', () => {
  const lines = parseAll('tools');
  const starts = lines.filter((l) => l.kind === 'tool_start');
  const ends = lines.filter((l) => l.kind === 'tool_end');
  expect(starts).toEqual([
    {
      kind: 'tool_start',
      toolId: 'toolu_01P59yKEokMC1Y7n92tpf8JE',
      name: 'read',
      args: { path: 'notes.txt' },
    },
    {
      kind: 'tool_start',
      toolId: 'toolu_01KzKJpB1BxruFFhonDFUbcG',
      name: 'bash',
      args: { command: 'ls' },
    },
  ]);
  expect(ends).toEqual([
    {
      kind: 'tool_end',
      toolId: 'toolu_01P59yKEokMC1Y7n92tpf8JE',
      name: 'read',
      result: { content: [{ type: 'text', text: 'The secret word is marmalade.\n' }] },
      isError: false,
    },
    {
      kind: 'tool_end',
      toolId: 'toolu_01KzKJpB1BxruFFhonDFUbcG',
      name: 'bash',
      result: { content: [{ type: 'text', text: 'notes.txt\n' }] },
      isError: false,
    },
  ]);
  // Tool-result messages are ignored: the tool_execution_end already carried the result.
  const assistants = lines.filter((l) => l.kind === 'assistant');
  expect(assistants).toHaveLength(2);
  expect(assistants[0]).toMatchObject({ message: { blocks: [], stopReason: 'toolUse' } });
  expect(assistants[1]).toMatchObject({
    message: {
      blocks: [
        {
          type: 'text',
          text: 'The directory contains only notes.txt, which reveals the secret word is marmalade.',
        },
      ],
      stopReason: 'stop',
    },
  });
});

test('the Flux tools appear like any other tool', () => {
  const lines = parseAll('flux-tools');
  expect(lines.filter((l) => l.kind === 'tool_start')).toMatchObject([
    { name: 'flux_notify' },
    { name: 'flux_ask' },
  ]);
  expect(lines).toContainEqual({
    kind: 'tool_end',
    toolId: expect.any(String),
    name: 'flux_ask',
    result: { content: [{ type: 'text', text: 'blue' }], details: {} },
    isError: false,
  });
});

test('an aborted run ends with stopReason aborted and the abort response is ignored', () => {
  const lines = parseAll('interrupt');
  const last = lines.findLast((l) => l.kind === 'assistant');
  expect(last).toMatchObject({
    message: { stopReason: 'aborted', errorMessage: 'This operation was aborted' },
  });
  expect(lines.at(-1)).toEqual({ kind: 'ignored' });
  expect(lines.at(-2)).toEqual({ kind: 'agent_settled' });
});

test('a resumed session replies from memory', () => {
  const lines = parseAll('resume');
  expect(lines.filter((l) => l.kind === 'assistant')).toHaveLength(1);
  expect(lines).toContainEqual({ kind: 'delta', text: 'pong' });
});

test('a bad model is an assistant message with stopReason error and no text', () => {
  const lines = parseAll('bad-model');
  const failed = lines.find((l) => l.kind === 'assistant');
  expect(failed).toEqual({
    kind: 'assistant',
    message: {
      blocks: [],
      stopReason: 'error',
      errorMessage:
        '404 {"type":"error","error":{"type":"not_found_error","message":"model: no-such-model"},"request_id":"req_011CeX78mrAj15GPMpDyywUw"}',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
    },
  });
});

test('shapes outside the fixtures: not JSON, no type, failed response, unknown event', () => {
  expect(parsePiLine('nope')).toBeNull();
  expect(parsePiLine('{"foo":1}')).toBeNull();
  expect(parsePiLine('[1]')).toBeNull();
  expect(
    parsePiLine('{"type":"response","command":"prompt","success":false,"error":"busy"}'),
  ).toEqual({
    kind: 'response_error',
    command: 'prompt',
    error: 'busy',
  });
  expect(parsePiLine('{"type":"response","success":false}')).toEqual({
    kind: 'response_error',
    command: '',
    error: 'command failed',
  });
  expect(parsePiLine('{"type":"compaction_start","reason":"threshold"}')).toEqual({
    kind: 'notice',
    event: 'compaction_start',
    fields: { reason: 'threshold' },
  });
  expect(parsePiLine('{"type":"unknown_event","x":1}')).toEqual({
    kind: 'other',
    data: { type: 'unknown_event', x: 1 },
  });
});

test('shapes outside the fixtures: odd message and tool payloads', () => {
  expect(parsePiLine('{"type":"message_end"}')).toEqual({
    kind: 'other',
    data: { type: 'message_end' },
  });
  expect(parsePiLine('{"type":"message_end","message":{"role":"toolResult"}}')).toEqual({
    kind: 'ignored',
  });
  expect(
    parsePiLine('{"type":"message_end","message":{"role":"assistant","content":"x"}}'),
  ).toEqual({
    kind: 'assistant',
    message: { blocks: [], stopReason: 'stop' },
  });
  expect(
    parsePiLine(
      '{"type":"message_end","message":{"role":"assistant","content":[],"usage":{"input":1,"output":2,"cacheRead":3,"cacheWrite":4}}}',
    ),
  ).toMatchObject({
    message: { usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, costUsd: 0 } },
  });
  expect(
    parsePiLine(
      '{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","delta":"x"}}',
    ),
  ).toEqual({
    kind: 'ignored',
  });
  expect(parsePiLine('{"type":"tool_execution_start","toolName":"bash"}')).toMatchObject({
    kind: 'other',
  });
  expect(parsePiLine('{"type":"tool_execution_end","toolCallId":"t"}')).toMatchObject({
    kind: 'other',
  });
  expect(parsePiLine('{"type":"tool_execution_end","toolCallId":"t","toolName":"bash"}')).toEqual({
    kind: 'tool_end',
    toolId: 't',
    name: 'bash',
    result: undefined,
    isError: false,
  });
});

test('retries, compaction, extension errors and dialogs are notices reduced to their fields', () => {
  const retry = JSON.stringify({
    type: 'auto_retry_start',
    attempt: 1,
    maxAttempts: 3,
    delayMs: 2000,
    errorMessage: '529 overloaded',
    messages: [{ big: true }],
  });
  expect(parsePiLine(retry)).toEqual({
    kind: 'notice',
    event: 'auto_retry_start',
    fields: { attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: '529 overloaded' },
  });
  expect(parsePiLine('{"type":"auto_retry_end","success":true,"attempt":2}')).toEqual({
    kind: 'notice',
    event: 'auto_retry_end',
    fields: { success: true, attempt: 2 },
  });
  const compacted = JSON.stringify({
    type: 'compaction_end',
    reason: 'overflow',
    result: { summary: 'long' },
    aborted: false,
    willRetry: true,
  });
  expect(parsePiLine(compacted)).toEqual({
    kind: 'notice',
    event: 'compaction_end',
    fields: { reason: 'overflow', aborted: false, willRetry: true },
  });
});

test('extension errors and dialogs are notices; bash output chunks are dropped', () => {
  expect(
    parsePiLine(
      '{"type":"extension_error","extensionPath":"/x.ts","event":"tool_call","error":"boom"}',
    ),
  ).toEqual({
    kind: 'notice',
    event: 'extension_error',
    fields: { extensionPath: '/x.ts', event: 'tool_call', error: 'boom' },
  });
  expect(
    parsePiLine('{"type":"extension_ui_request","id":"u1","method":"confirm","title":"Sure?"}'),
  ).toEqual({
    kind: 'notice',
    event: 'extension_ui_request',
    fields: { method: 'confirm', title: 'Sure?' },
  });
  expect(parsePiLine('{"type":"bash_execution_update","id":"b","delta":"x"}')).toEqual({
    kind: 'ignored',
  });
});
