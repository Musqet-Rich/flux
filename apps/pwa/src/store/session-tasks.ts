import type { FluxEvent } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';

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
// are in and the current turn is known.
interface Collected {
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

const closeOpen = (c: Collected): void => {
  for (const task of c.tasks) if (task.status === 'running') end(c, task, 'interrupted');
};

const byId = (tasks: SessionTask[], taskId: string): SessionTask | undefined =>
  tasks.find((t) => t.taskId === taskId);

const collect = (events: readonly FluxEvent[]): Collected => {
  const c: Collected = { tasks: [], endedIn: new Map(), turn: 0 };
  const { tasks } = c;
  for (const event of events) {
    if (!fluxEvent.isKnown(event)) continue;
    if (event.type === 'msg.user') {
      if ((event.parent ?? null) === null) c.turn += 1;
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
      if (task !== undefined && task.status === 'running') {
        task.progress = event.payload.description;
        task.tokens = event.payload.tokens ?? task.tokens;
      }
    } else if (event.type === 'task.ended') {
      const task = byId(tasks, event.payload.taskId);
      if (task === undefined) continue;
      end(c, task, event.payload.status);
      task.summary = event.payload.summary;
      task.tokens = event.payload.tokens ?? task.tokens;
    } else if (event.type === 'session.cleared') {
      closeOpen(c);
      c.turn += 1;
    } else if (event.type === 'session.state' && stopped.has(event.payload.state)) closeOpen(c);
  }
  return c;
};

const isCurrent = (c: Collected, task: SessionTask): boolean =>
  task.status === 'running' || c.endedIn.get(task.taskId) === c.turn;

// Children go under their parent in start order; a task whose parent is not a known task
// (the log was cut, or the box logged the child first) sits at the top level. The rows are
// `collect`'s own objects, so the depth and `current` are written in place, a child taking
// its parent's `current`.
const flatten = (
  c: Collected,
  parent: SessionTask | null,
  depth: number,
  into: SessionTask[],
): SessionTask[] => {
  const { tasks } = c;
  const known = new Set(tasks.map((t) => t.toolUseId));
  const own = tasks.filter((t) =>
    parent === null ? t.parent === null || !known.has(t.parent) : t.parent === parent.toolUseId,
  );
  for (const task of own) {
    task.depth = depth;
    task.current = parent === null ? isCurrent(c, task) : parent.current;
    into.push(task);
    flatten(c, task, depth + 1, into);
  }
  return into;
};

export const sessionTasks = (events: readonly FluxEvent[]): SessionTask[] =>
  flatten(collect(events), null, 0, []);
