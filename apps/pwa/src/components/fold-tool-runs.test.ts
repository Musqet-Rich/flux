import type { EventPayloads, EventType, FluxEvent } from '@flux/protocol';
import { beforeEach, expect, test } from 'vitest';

import { foldToolRuns } from './fold-tool-runs.ts';

let seq = 0;
beforeEach(() => {
  seq = 0;
});
const ev = <T extends EventType>(type: T, payload: EventPayloads[T]): FluxEvent => ({
  seq: (seq += 1),
  ts: '2026-01-01T00:00:00Z',
  session: 's1',
  type,
  payload,
});
const start = (): FluxEvent =>
  ev('tool.start', { toolId: 't', name: 'Bash', input: {}, summary: 'Bash: ls' });
const end = (ok = true): FluxEvent => ev('tool.end', { toolId: 't', ok, summary: 'Bash ok' });
const say = (text: string): FluxEvent => ev('msg.assistant', { text });

const shape = (rows: readonly FluxEvent[]): string[] =>
  foldToolRuns(rows).map((entry) =>
    entry.kind === 'row'
      ? `${entry.seq}:${entry.row.type}`
      : `${entry.seq}:fold(${entry.rows.length}) ${entry.text}${entry.tone === null ? '' : ' !'}`,
  );

test('a run of tool calls that a later row follows folds; the trailing run stays flat', () => {
  const rows = [say('a'), start(), end(), start(), end(), say('b'), start(), end(), start()];
  expect(shape(rows)).toEqual([
    '1:msg.assistant',
    '5:fold(4) 2 tool calls',
    '6:msg.assistant',
    '7:tool.start',
    '8:tool.end',
    '9:tool.start',
  ]);
});

test('a single call, start and end, is not worth a fold', () => {
  const rows = [start(), end(), say('a')];
  expect(shape(rows)).toEqual(['1:tool.start', '2:tool.end', '3:msg.assistant']);
});

test('any row that is not a tool call ends a run', () => {
  const rows = [
    start(),
    ev('task.started', { taskId: 'k', toolUseId: 't', description: 'look', background: false }),
    start(),
    end(),
    end(),
    ev('task.ended', { taskId: 'k', status: 'completed', summary: '' }),
    start(),
    end(),
    start(),
    end(),
    ev('session.state', { state: 'idle' }),
  ];
  expect(shape(rows)).toEqual([
    '1:tool.start',
    '2:task.started',
    '5:fold(3) 2 tool calls',
    '6:task.ended',
    '10:fold(4) 2 tool calls',
    '11:session.state',
  ]);
});

test('a fold counts its failures and takes the error tone', () => {
  const rows = [start(), end(false), start(), end(), start(), end(false), say('a')];
  expect(shape(rows)).toEqual(['6:fold(6) 3 tool calls, 2 failed !', '7:msg.assistant']);
});

test('a run the window cut into is counted by what is left of it', () => {
  // The window's top edge fell between a call's start and end, and the next call is whole.
  const rows = [end(), start(), end(), say('a')];
  expect(shape(rows)).toEqual(['3:fold(3) 2 tool calls', '4:msg.assistant']);
  // Only ends survive: still one row per call.
  expect(shape([end(), end(), end(), say('b')])).toEqual([
    '7:fold(3) 3 tool calls',
    '8:msg.assistant',
  ]);
});

test('unknown types are not tool calls, whatever they look like', () => {
  const rows = [start(), end(), { ...end(), type: 'tool.future' }, say('a')];
  expect(shape(rows)).toEqual(['1:tool.start', '2:tool.end', '3:tool.future', '4:msg.assistant']);
});

test('a hold keeps every run that reaches it flat, and those before it fold', () => {
  const rows = [start(), end(), start(), end(), say('a'), start(), end(), start(), end(), say('b')];
  expect(shape(rows)).toEqual([
    '4:fold(4) 2 tool calls',
    '5:msg.assistant',
    '9:fold(4) 2 tool calls',
    '10:msg.assistant',
  ]);
  // Held from the second run's first row: the first run is history, the second the operator's.
  expect(foldToolRuns(rows, 6).map((entry) => entry.kind)).toEqual([
    'fold',
    'row',
    'row',
    'row',
    'row',
    'row',
    'row',
  ]);
  // Held from the last row shown when the hold was taken, a message: only later runs are kept.
  expect(foldToolRuns(rows, 5).map((entry) => entry.kind)).toEqual([
    'fold',
    'row',
    'row',
    'row',
    'row',
    'row',
    'row',
  ]);
  // Held at a run's own last row: that run is on screen and stays.
  expect(foldToolRuns(rows, 9).map((entry) => entry.kind)).toEqual([
    'fold',
    'row',
    'row',
    'row',
    'row',
    'row',
    'row',
  ]);
  expect(foldToolRuns(rows, 10).map((entry) => entry.kind)).toEqual(['fold', 'row', 'fold', 'row']);
});
