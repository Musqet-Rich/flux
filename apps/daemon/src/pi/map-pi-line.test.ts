import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

import type { EventInput } from '../create-event-log.ts';
import type { PiPending } from './map-pi-line.ts';
import { mapPiLine } from './map-pi-line.ts';
import { parsePiLine } from './parse-pi-line.ts';

// Drives the mapper with whole fixtures and checks the Flux events that come out, so the pi
// column of the table in architecture.md § Adapter is what the tests say it is.

const cwd = '/work';

const pending = (): PiPending => ({
  tools: new Map(),
  run: {
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
    messages: 0,
    stopReason: undefined,
  },
});

interface Outcome {
  events: EventInput[];
  deltas: string[];
  contexts: { tokens: number; model: string }[];
  running: number;
  turnsEnded: number;
  filesChanged: number;
}

const run = (name: string, state = pending()): Outcome => {
  const outcome: Outcome = {
    events: [],
    deltas: [],
    contexts: [],
    running: 0,
    turnsEnded: 0,
    filesChanged: 0,
  };
  const text = readFileSync(
    fileURLToPath(new URL(`../../test/fixtures/pi/${name}.jsonl`, import.meta.url)),
    'utf8',
  );
  for (const line of text.split('\n').filter((l) => l.trim() !== '')) {
    const parsed = parsePiLine(line);
    if (parsed === null) continue;
    const mapped = mapPiLine(parsed, state, cwd);
    outcome.events.push(...mapped.events);
    if (mapped.delta !== undefined) outcome.deltas.push(mapped.delta);
    if (mapped.context !== undefined) outcome.contexts.push(mapped.context);
    if (mapped.running === true) outcome.running += 1;
    if (mapped.turnEnded === true) outcome.turnsEnded += 1;
    if (mapped.filesChanged === true) outcome.filesChanged += 1;
  }
  return outcome;
};

test('a text reply becomes one msg.assistant and one turn.ended with usage and cost', () => {
  const { events, deltas, contexts, running, turnsEnded } = run('text-reply');
  expect(running).toBe(1);
  expect(deltas.join('')).toBe('pong');
  expect(turnsEnded).toBe(1);
  // The message's input side is that call's prompt: the context in use, keyed by the model
  // pi resolved the alias to.
  expect(contexts).toEqual([{ tokens: 3415, model: 'claude-haiku-4-5-20251001' }]);
  expect(events).toEqual([
    { type: 'msg.assistant', payload: { text: 'pong' } },
    {
      type: 'turn.ended',
      payload: {
        costUsd: expect.any(Number),
        numTurns: 1,
        stopReason: 'stop',
        usage: { input: 3415, output: 5, cacheRead: 0, cacheWrite: 0 },
      },
    },
  ]);
  const ended = events[1]?.payload as { costUsd: number };
  expect(ended.costUsd).toBeGreaterThan(0);
});

test('tools become tool.start / tool.end pairs with summaries, and bash flags a possible write', () => {
  const { events, filesChanged } = run('tools');
  expect(events.map((e) => e.type)).toEqual([
    'tool.start',
    'tool.start',
    'tool.end',
    'tool.end',
    'msg.assistant',
    'turn.ended',
  ]);
  expect(events[0]?.payload).toEqual({
    toolId: 'toolu_01P59yKEokMC1Y7n92tpf8JE',
    name: 'read',
    input: { path: 'notes.txt' },
    summary: 'read notes.txt',
  });
  expect(events[1]?.payload).toMatchObject({ name: 'bash', summary: 'bash: ls' });
  expect(events[2]?.payload).toEqual({
    toolId: 'toolu_01P59yKEokMC1Y7n92tpf8JE',
    ok: true,
    summary: 'read ok, 1 line',
    output: 'The secret word is marmalade.\n',
  });
  expect(events[3]?.payload).toMatchObject({
    ok: true,
    summary: 'bash ok, 1 line',
    output: 'notes.txt\n',
  });
  expect(filesChanged).toBe(1);
  // Two assistant messages (the tool call and the reply) sum into the run's usage.
  expect(events[5]?.payload).toMatchObject({ numTurns: 2, stopReason: 'stop' });
});

test('every model call in a run reports its own context, the later one larger', () => {
  const { contexts } = run('tools');
  expect(contexts).toEqual([
    { tokens: 3435, model: 'claude-haiku-4-5-20251001' },
    { tokens: 3595, model: 'claude-haiku-4-5-20251001' },
  ]);
});

test('the Flux tools render as ask / notify', () => {
  const { events } = run('flux-tools');
  const summaries = events.filter((e) => e.type === 'tool.start').map((e) => e.payload);
  expect(summaries).toEqual([
    expect.objectContaining({ name: 'flux_notify', summary: 'notify info: starting' }),
    expect.objectContaining({ name: 'flux_ask', summary: 'ask: Red or blue?' }),
  ]);
  expect(events.at(-2)).toEqual({ type: 'msg.assistant', payload: { text: 'blue' } });
});

test('an interrupted run still ends the turn, with stopReason aborted, and write flags a change', () => {
  const { events, turnsEnded, filesChanged } = run('interrupt');
  expect(turnsEnded).toBe(1);
  expect(filesChanged).toBe(1);
  expect(events.at(-1)).toMatchObject({
    type: 'turn.ended',
    payload: { stopReason: 'aborted', numTurns: 2 },
  });
});

test('a failed call is logged raw with the error and ends the turn with stopReason error', () => {
  const { events, contexts } = run('bad-model');
  // A call that never reached a model has no prompt size to report.
  expect(contexts).toEqual([]);
  expect(events).toEqual([
    {
      type: 'raw',
      payload: {
        agent: 'pi',
        data: {
          error:
            '404 {"type":"error","error":{"type":"not_found_error","message":"model: no-such-model"},"request_id":"req_011CeX78mrAj15GPMpDyywUw"}',
        },
      },
    },
    {
      type: 'turn.ended',
      payload: {
        costUsd: 0,
        numTurns: 1,
        stopReason: 'error',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    },
  ]);
});

test('the run accumulator resets between runs on the same process', () => {
  const state = pending();
  const first = run('text-reply', state);
  const second = run('resume', state);
  expect(first.events.at(-1)).toMatchObject({ payload: { numTurns: 1 } });
  expect(second.events.at(-1)).toMatchObject({ payload: { numTurns: 1 } });
  expect(state.tools.size).toBe(0);
});

test('lines outside the fixtures: failed responses and unknown events are raw, a settled run without messages is a bare turn', () => {
  const state = pending();
  expect(
    mapPiLine({ kind: 'response_error', command: 'prompt', error: 'busy' }, state, cwd),
  ).toEqual({
    events: [{ type: 'raw', payload: { agent: 'pi', data: { command: 'prompt', error: 'busy' } } }],
  });
  expect(mapPiLine({ kind: 'other', data: { type: 'x' } }, state, cwd)).toEqual({
    events: [{ type: 'raw', payload: { agent: 'pi', data: { type: 'x' } } }],
  });
  expect(mapPiLine({ kind: 'ignored' }, state, cwd)).toEqual({ events: [] });
  expect(
    mapPiLine({ kind: 'notice', event: 'auto_retry_start', fields: { attempt: 1 } }, state, cwd),
  ).toEqual({
    events: [
      { type: 'raw', payload: { agent: 'pi', data: { event: 'auto_retry_start', attempt: 1 } } },
    ],
  });
  expect(mapPiLine({ kind: 'user' }, state, cwd)).toEqual({ events: [] });
  expect(mapPiLine({ kind: 'agent_settled' }, state, cwd)).toEqual({
    turnEnded: true,
    events: [
      {
        type: 'turn.ended',
        payload: {
          costUsd: 0,
          numTurns: 0,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      },
    ],
  });
});

test('a failed tool is not a write, and long output is capped', () => {
  const state = pending();
  const failed = mapPiLine(
    {
      kind: 'tool_end',
      toolId: 't',
      name: 'edit',
      result: { content: [{ type: 'text', text: 'no' }] },
      isError: true,
    },
    state,
    cwd,
  );
  expect(failed).toEqual({
    events: [
      {
        type: 'tool.end',
        payload: { toolId: 't', ok: false, summary: 'edit failed', output: 'no' },
      },
    ],
    filesChanged: false,
  });
  const big = mapPiLine(
    {
      kind: 'tool_end',
      toolId: 't',
      name: 'bash',
      result: { content: [{ type: 'text', text: 'x'.repeat(70000) }] },
      isError: false,
    },
    state,
    cwd,
  );
  expect(big.events[0]).toMatchObject({
    payload: { output: expect.stringContaining('[truncated 4464 bytes]') },
  });
});

test('the output cap is measured in bytes: 30000 three-byte characters are 24464 bytes over', () => {
  const state = pending();
  const wide = mapPiLine(
    {
      kind: 'tool_end',
      toolId: 't',
      name: 'bash',
      result: { content: [{ type: 'text', text: '€'.repeat(30000) }] },
      isError: false,
    },
    state,
    cwd,
  );
  expect(wide.events[0]).toMatchObject({
    payload: { output: expect.stringContaining('[truncated 24464 bytes]') },
  });
});
