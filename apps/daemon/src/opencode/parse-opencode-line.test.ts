import { expect, test } from 'vitest';

import { parseOpencodeLine } from './parse-opencode-line.ts';

// Guards the shapes seen in the fixtures (test/fixtures/opencode) plus the reasoning/error parts
// the fixtures do not carry; anything else is `other` and blank/garbage is null (ADR 0027 § 2).

test('null for blank or unparseable lines', () => {
  expect(parseOpencodeLine('')).toBeNull();
  expect(parseOpencodeLine('not json')).toBeNull();
  expect(parseOpencodeLine('[]')).toBeNull();
  expect(parseOpencodeLine('{"noType":1}')).toBeNull();
});

test('step_start carries the session id, or is ignored without one', () => {
  expect(parseOpencodeLine('{"type":"step_start","sessionID":"ses_x","part":{}}')).toEqual({
    kind: 'step_start',
    sessionId: 'ses_x',
  });
  expect(parseOpencodeLine('{"type":"step_start","part":{}}')).toEqual({ kind: 'ignored' });
});

test('text takes the part text, or is ignored when absent', () => {
  expect(parseOpencodeLine('{"type":"text","part":{"type":"text","text":"hi"}}')).toEqual({
    kind: 'text',
    text: 'hi',
  });
  expect(parseOpencodeLine('{"type":"text","part":{}}')).toEqual({ kind: 'ignored' });
});

test('tool_use is one self-contained call with args, output and success', () => {
  const line =
    '{"type":"tool_use","part":{"type":"tool","tool":"bash","callID":"c1","state":{"status":"completed","input":{"command":"ls"},"output":"a\\nb"}}}';
  expect(parseOpencodeLine(line)).toEqual({
    kind: 'tool',
    call: { tool: 'bash', callId: 'c1', ok: true, input: { command: 'ls' }, output: 'a\nb' },
  });
});

test('a failed tool call reports ok false and a missing output as empty', () => {
  const line =
    '{"type":"tool_use","part":{"type":"tool","tool":"bash","callID":"c2","state":{"status":"error"}}}';
  expect(parseOpencodeLine(line)).toEqual({
    kind: 'tool',
    call: { tool: 'bash', callId: 'c2', ok: false, input: undefined, output: '' },
  });
});

test('a tool_use without a tool name or call id is other', () => {
  const line = '{"type":"tool_use","part":{"type":"tool","state":{"status":"completed"}}}';
  expect(parseOpencodeLine(line)?.kind).toBe('other');
});

test('step_finish reads reason, summed-per-step tokens and real cost', () => {
  const line =
    '{"type":"step_finish","part":{"reason":"stop","tokens":{"input":2,"output":8,"cache":{"write":10,"read":3}},"cost":0.5}}';
  expect(parseOpencodeLine(line)).toEqual({
    kind: 'step_finish',
    reason: 'stop',
    tokens: { input: 2, output: 8, cacheWrite: 10, cacheRead: 3 },
    cost: 0.5,
  });
});

test('step_finish tolerates missing tokens and cost', () => {
  expect(parseOpencodeLine('{"type":"step_finish","part":{}}')).toEqual({
    kind: 'step_finish',
    reason: 'stop',
    tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    cost: 0,
  });
});

test('reasoning and error parts map to their kinds', () => {
  expect(parseOpencodeLine('{"type":"reasoning","part":{}}')).toEqual({ kind: 'reasoning' });
  expect(parseOpencodeLine('{"type":"error","part":{"error":"boom"}}')).toEqual({
    kind: 'error',
    message: 'boom',
  });
  expect(parseOpencodeLine('{"type":"error","error":"top","part":{}}')).toEqual({
    kind: 'error',
    message: 'top',
  });
  expect(parseOpencodeLine('{"type":"error","part":{}}')).toEqual({
    kind: 'error',
    message: 'opencode error',
  });
});

test('an unrecognised type is other', () => {
  expect(parseOpencodeLine('{"type":"queue_update","part":{}}')?.kind).toBe('other');
});
