import type { FluxEvent } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';

// The subagents a session has run, as the agents strip shows them (architecture.md § PWA):
// one row per `task.started`, in start order, each nested task indented under the task whose
// Agent call spawned it. Derived from log rows alone: a `task.ended` closes its row; a task
// still open when the session leaves `running` (`session.state` idle or ended) or the context
// is cleared was interrupted, since the box synthesises no boundary for it.

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
}

// waiting_user is still a running turn: the agent is blocked on an ask, its tasks with it.
const stopped = new Set(['idle', 'ended']);

const end = (task: SessionTask, status: string): void => {
  task.status = status;
  task.progress = null;
};

const closeOpen = (tasks: SessionTask[]): void => {
  for (const task of tasks) if (task.status === 'running') end(task, 'interrupted');
};

const byId = (tasks: SessionTask[], taskId: string): SessionTask | undefined =>
  tasks.find((t) => t.taskId === taskId);

const collect = (events: readonly FluxEvent[]): SessionTask[] => {
  const tasks: SessionTask[] = [];
  for (const event of events) {
    if (!fluxEvent.isKnown(event)) continue;
    if (event.type === 'task.started') {
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
      end(task, event.payload.status);
      task.summary = event.payload.summary;
      task.tokens = event.payload.tokens ?? task.tokens;
    } else if (event.type === 'session.cleared') closeOpen(tasks);
    else if (event.type === 'session.state' && stopped.has(event.payload.state)) closeOpen(tasks);
  }
  return tasks;
};

// Children go under their parent in start order; a task whose parent is not a known task
// (the log was cut, or the box logged the child first) sits at the top level. The rows are
// `collect`'s own objects, so the depth is written in place.
const flatten = (
  tasks: SessionTask[],
  parent: string | null,
  depth: number,
  into: SessionTask[],
): SessionTask[] => {
  const known = new Set(tasks.map((t) => t.toolUseId));
  const own = tasks.filter((t) =>
    parent === null ? t.parent === null || !known.has(t.parent) : t.parent === parent,
  );
  for (const task of own) {
    task.depth = depth;
    into.push(task);
    flatten(tasks, task.toolUseId, depth + 1, into);
  }
  return into;
};

export const sessionTasks = (events: readonly FluxEvent[]): SessionTask[] =>
  flatten(collect(events), null, 0, []);
