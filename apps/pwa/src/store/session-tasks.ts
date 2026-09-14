import type { FluxEvent } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';

import type { LogFold } from './log-fold.ts';

// The subagents a session has run, as the agents strip shows them (architecture.md § PWA):
// one row per `task.started`, in start order, each nested task indented under the task whose
// Agent call spawned it. Derived from log rows alone: a `task.ended` closes its row; a task
// still open when the session leaves `running` (`session.state` idle or ended) or the context
// is cleared was interrupted, since the box synthesises no boundary for it.
//
// The strip shows current tasks only: `main`, every task still running, and the tasks that
// ended in the current turn, a turn starting at each top-level `msg.user` and at each
// `session.cleared`. Earlier turns' tasks drop out of the strip when the operator sends the
// next message; their chats stay reachable from the `task.started` note in the main timeline.
// A nested task follows its parent's visibility.

export interface SessionTask {
  taskId: string;
  toolUseId: string;
  // The task whose agent spawned this one (its `toolUseId`), null at the top level.
  parent: string | null;
  depth: number;
  agentType: string | null;
  description: string;
  // The latest `task.progress` while the task runs (what it is doing now), else null.
  progress: string | null;
  // 'running' until ended; then the agent's status ('completed', 'failed', …), or
  // 'interrupted' when the session moved on without one.
  status: string;
  summary: string;
  tokens: number | null;
  // Whether the strip lists the task: running, or ended in the current turn (a nested task
  // takes its parent's answer).
  current: boolean;
}

// The turn a task ended in, tracked while collecting; `current` is settled once all rows
// are in and the current turn is known. `flattenTasks` reads this; the fold below keeps it.
export interface Collected {
  tasks: SessionTask[];
  endedIn: Map<string, number>;
  turn: number;
}

// waiting_user is still a running turn: the agent is blocked on an ask, its tasks with it.
const stopped = new Set(['idle', 'ended']);

const end = (c: Collected, task: SessionTask, status: string): void => {
  task.status = status;
  task.progress = null;
  c.endedIn.set(task.taskId, c.turn);
};

// True when a task was open to close.
const closeOpen = (c: Collected): boolean => {
  let closed = false;
  for (const task of c.tasks) {
    if (task.status !== 'running') continue;
    end(c, task, 'interrupted');
    closed = true;
  }
  return closed;
};

const byId = (tasks: SessionTask[], taskId: string): SessionTask | undefined =>
  tasks.find((t) => t.taskId === taskId);

// One event into the collection: a fresh wrapper around the same rows when it changed
// anything, the value given otherwise. The rows and the ended map are the fold's own, changed
// in place; the wrapper's `turn` is not, so an earlier wrapper keeps its turn.
const step = (c: Collected, event: FluxEvent): Collected => {
  if (!fluxEvent.isKnown(event)) return c;
  const { tasks } = c;
  if (event.type === 'msg.user') {
    if ((event.parent ?? null) !== null) return c;
    return { ...c, turn: c.turn + 1 };
  } else if (event.type === 'task.started') {
    const { taskId, toolUseId, description, agentType } = event.payload;
    tasks.push({
      taskId,
      toolUseId,
      parent: event.parent ?? null,
      depth: 0,
      agentType: agentType ?? null,
      description,
      progress: null,
      status: 'running',
      summary: '',
      tokens: null,
      current: true,
    });
  } else if (event.type === 'task.progress') {
    const task = byId(tasks, event.payload.taskId);
    if (task === undefined || task.status !== 'running') return c;
    task.progress = event.payload.description;
    task.tokens = event.payload.tokens ?? task.tokens;
  } else if (event.type === 'task.ended') {
    const task = byId(tasks, event.payload.taskId);
    if (task === undefined) return c;
    end(c, task, event.payload.status);
    task.summary = event.payload.summary;
    task.tokens = event.payload.tokens ?? task.tokens;
  } else if (event.type === 'session.cleared') {
    closeOpen(c);
    return { ...c, turn: c.turn + 1 };
  } else if (event.type === 'session.state' && stopped.has(event.payload.state)) {
    if (!closeOpen(c)) return c;
  } else return c;
  return { ...c };
};

const fold: LogFold<Collected> = {
  init: () => ({ tasks: [], endedIn: new Map(), turn: 0 }),
  step,
};

const isCurrent = (c: Collected, task: SessionTask): boolean =>
  task.status === 'running' || c.endedIn.get(task.taskId) === c.turn;

// Children go under their parent in start order; a task whose parent is not a known task
// (the log was cut, or the box logged the child first) sits at the top level. The rows are
// copies of the collection's, with the depth and `current` settled, a child taking its
// parent's `current`: copies, so a strip reading an earlier flatten sees its rows unchanged.
// The children are indexed once, by parent, so a session that has run a thousand tasks
// flattens in a pass over them.
const flatten = (
  c: Collected,
  children: Map<string | null, SessionTask[]>,
  parent: SessionTask | null,
  depth: number,
  into: SessionTask[],
): SessionTask[] => {
  for (const source of children.get(parent?.toolUseId ?? null) ?? []) {
    const task = {
      ...source,
      depth,
      current: parent === null ? isCurrent(c, source) : parent.current,
    };
    into.push(task);
    flatten(c, children, task, depth + 1, into);
  }
  return into;
};

const byParent = (tasks: SessionTask[]): Map<string | null, SessionTask[]> => {
  const known = new Set(tasks.map((t) => t.toolUseId));
  const children = new Map<string | null, SessionTask[]>();
  for (const task of tasks) {
    const parent = task.parent !== null && known.has(task.parent) ? task.parent : null;
    const own = children.get(parent) ?? [];
    own.push(task);
    children.set(parent, own);
  }
  return children;
};

// The fold collects; `flatten` makes the strip's rows of what it has collected.
export const sessionTasks: { fold: LogFold<Collected>; flatten: (c: Collected) => SessionTask[] } =
  {
    fold,
    flatten: (c) => flatten(c, byParent(c.tasks), null, 0, []),
  };
