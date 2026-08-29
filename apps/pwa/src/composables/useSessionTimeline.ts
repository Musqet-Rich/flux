import type { EventPayloads, FluxEvent } from '@flux/protocol';
import type { ComputedRef, Ref } from 'vue';
import { computed, ref } from 'vue';

import { openAsk } from '../store/open-ask.ts';
import type { SessionTask } from '../store/session-tasks.ts';
import { sessionTasks } from '../store/session-tasks.ts';

// What the session screen derives from its log: the subagent tasks for the strip, which chat
// is open (`main`, or a task's Agent call id), that chat's rows, and the agent's open question.
// Main shows top-level rows only; a subagent's chat shows the rows whose `parent` is its call,
// the last `pageSize` of them until the operator asks for earlier ones (no virtualisation:
// hundreds of rows render fine, thousands are what the button is for).

const pageSize = 200;

// Agent lines Flux does not read (`raw`) and rate-limit changes stay in the log for the ask,
// comment and sync logic, but they are noise on a phone: hooks and streaming envelopes would
// put half a dozen bare rows around every reply, and the status bar already shows the windows.
// `task.progress` only feeds the agents strip.
const hiddenTypes = new Set(['raw', 'rate_limit', 'task.progress']);

export interface SessionTimeline {
  tasks: ComputedRef<SessionTask[]>;
  // The open chat: null for main, else the task's `toolUseId`.
  view: Ref<string | null>;
  // The open task's row, null on main or once the task is gone (a cleared context).
  task: ComputedRef<SessionTask | null>;
  timeline: ComputedRef<FluxEvent[]>;
  // Rows of the open chat left out of `timeline`; Show earlier brings them in.
  earlier: ComputedRef<number>;
  ask: ComputedRef<EventPayloads['ask'] | null>;
  select: (view: string | null) => void;
  showEarlier: () => void;
}

export const useSessionTimeline = (events: () => readonly FluxEvent[]): SessionTimeline => {
  const view = ref<string | null>(null);
  const all = ref(false);
  const tasks = computed(() => sessionTasks(events()));
  const task = computed(() => tasks.value.find((t) => t.toolUseId === view.value) ?? null);
  const rows = computed(() =>
    events().filter((e) => !hiddenTypes.has(e.type) && (e.parent ?? null) === view.value),
  );
  const earlier = computed(() =>
    view.value === null || all.value ? 0 : Math.max(0, rows.value.length - pageSize),
  );
  const timeline = computed(() =>
    earlier.value === 0 ? rows.value : rows.value.slice(earlier.value),
  );
  const ask = computed(() => openAsk(events()));
  return {
    tasks,
    view,
    task,
    timeline,
    earlier,
    ask,
    select: (next) => {
      view.value = next;
      all.value = false;
    },
    showEarlier: () => {
      all.value = true;
    },
  };
};
