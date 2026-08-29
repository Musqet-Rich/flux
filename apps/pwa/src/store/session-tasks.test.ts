import type { FluxEvent } from '@flux/protocol';
import { expect, test } from 'vitest';

import { sessionTasks } from './session-tasks.ts';

let seq = 0;
const ev = (type: string, payload: unknown, parent?: string): FluxEvent => {
  seq += 1;
  const base = { seq, ts: '2026-01-01T00:00:00Z', session: 's1', type, payload };
  return parent === undefined ? base : { ...base, parent };
};
const started = (
  taskId: string,
  toolUseId: string,
  description: string,
  parent?: string,
  agentType?: string,
): FluxEvent =>
  ev(
    'task.started',
    {
      taskId,
      toolUseId,
      description,
      background: false,
      ...(agentType === undefined ? {} : { agentType }),
    },
    parent,
  );
const ended = (taskId: string, status: string, summary = '', tokens?: number): FluxEvent =>
  ev('task.ended', { taskId, status, summary, ...(tokens === undefined ? {} : { tokens }) });

test('opens a row per task.started and closes it with its task.ended', () => {
  const tasks = sessionTasks([
    started('t1', 'u1', 'List files', undefined, 'Explore'),
    started('t2', 'u2', 'Read a.txt', undefined, 'Explore'),
    ended('t2', 'completed', 'alpha', 12070),
    ev('msg.assistant', { text: 'x' }, 'u1'),
  ]);
  expect(tasks).toEqual([
    {
      taskId: 't1',
      toolUseId: 'u1',
      parent: null,
      depth: 0,
      agentType: 'Explore',
      description: 'List files',
      progress: null,
      status: 'running',
      summary: '',
      tokens: null,
    },
    {
      taskId: 't2',
      toolUseId: 'u2',
      parent: null,
      depth: 0,
      agentType: 'Explore',
      description: 'Read a.txt',
      progress: null,
      status: 'completed',
      summary: 'alpha',
      tokens: 12070,
    },
  ]);
});

// The box synthesises no task.ended for a task the operator's Stop (or the turn ending) cut
// short; the session leaving `running` is the boundary. waiting_user is still running.
test('a task still open when the session goes idle, ends or is cleared was interrupted', () => {
  const idle = sessionTasks([
    started('t1', 'u1', 'a'),
    ev('session.state', { state: 'waiting_user' }),
    started('t2', 'u2', 'b'),
    ev('session.state', { state: 'idle' }),
    started('t3', 'u3', 'c'),
  ]);
  expect(idle.map((t) => t.status)).toEqual(['interrupted', 'interrupted', 'running']);
  const killed = sessionTasks([started('t1', 'u1', 'a'), ev('session.state', { state: 'ended' })]);
  expect(killed[0]?.status).toBe('interrupted');
  const cleared = sessionTasks([started('t1', 'u1', 'a'), ev('session.cleared', {})]);
  expect(cleared[0]?.status).toBe('interrupted');
  const failed = sessionTasks([
    started('t1', 'u1', 'a'),
    ended('t1', 'failed', 'boom'),
    ev('session.state', { state: 'idle' }),
  ]);
  expect(failed[0]).toMatchObject({ status: 'failed', summary: 'boom' });
});

// A nested task's task.started carries the child agent's Agent call as its parent; the strip
// shows it indented under that task, right after it, whatever the log order of later siblings.
test('nested tasks sit under their parent, one level deeper', () => {
  const tasks = sessionTasks([
    started('t1', 'u1', 'outer'),
    started('t2', 'u2', 'sibling'),
    started('t3', 'u3', 'inner', 'u1'),
    started('t4', 'u4', 'innermost', 'u3'),
    started('t5', 'u5', 'orphan', 'u-unknown'),
    ended('t3', 'completed'),
  ]);
  expect(tasks.map((t) => [t.taskId, t.depth, t.parent])).toEqual([
    ['t1', 0, null],
    ['t3', 1, 'u1'],
    ['t4', 2, 'u3'],
    ['t2', 0, null],
    ['t5', 0, 'u-unknown'],
  ]);
});

const progress = (taskId: string, description: string, tokens?: number): FluxEvent =>
  ev('task.progress', { taskId, description, ...(tokens === undefined ? {} : { tokens }) });

// A task's progress is what it is doing now: the latest note wins, it carries the usage so
// far, and it is gone once the task has ended, when the description reads better than a
// stale "Reading a.txt".
test('keeps the latest progress and its tokens while a task runs, none once it ended', () => {
  const tasks = sessionTasks([
    started('t1', 'u1', 'a'),
    started('t2', 'u2', 'b'),
    progress('t1', 'Reading a.txt', 11717),
    progress('t1', 'Running ls'),
    progress('t2', 'Searching', 5),
    progress('nope', 'x'),
    ended('t2', 'completed', 'done'),
    progress('t2', 'late'),
  ]);
  expect(tasks.map((t) => [t.progress, t.tokens])).toEqual([
    ['Running ls', 11717],
    [null, 5],
  ]);
});

test('ignores unknown events and an ended for a task it never saw', () => {
  const tasks = sessionTasks([
    ev('msg.future', { x: 1 }),
    ended('nope', 'completed'),
    ev('session.state', { state: 'running' }),
    started('t1', 'u1', 'a'),
  ]);
  expect(tasks.map((t) => t.status)).toEqual(['running']);
});
