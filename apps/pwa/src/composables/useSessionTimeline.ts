import type { EventPayloads, FluxEvent } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';
import type { ComputedRef, Ref } from 'vue';
import { computed, ref } from 'vue';

import { openAsk } from '../store/open-ask.ts';
import type { SessionTask } from '../store/session-tasks.ts';
import { sessionTasks } from '../store/session-tasks.ts';
import type { MessageReply } from './useMessageReply.ts';
import { useMessageReply } from './useMessageReply.ts';

// What the session screen derives from its log: the subagent tasks and the strip's cut of
// them (the current ones, plus the open chat's own row so Back has somewhere to be), which chat
// is open (`main`, or a task's Agent call id), that chat's rows, and the agent's open question.
// Main shows top-level rows only; a subagent's chat shows the rows whose `parent` is its call,
// the last `pageSize` of them until the operator asks for earlier ones (no virtualisation:
// hundreds of rows render fine, thousands are what the button is for). The reply state
// (useMessageReply) rides along so the screen has one object for what its log means.

const pageSize = 200;

// Agent lines Flux does not read (`raw`), rate-limit changes and `files.changed` stay in the log
// for the ask, comment, sync and Changes logic, but they are noise on a phone: hooks and streaming
// envelopes would put half a dozen bare rows around every reply, a subagent repeats `files.changed`
// on every write, and the status bar and Changes button already carry what they say.
// `task.progress` only feeds the agents strip.
const hiddenTypes = new Set(['raw', 'rate_limit', 'files.changed', 'task.progress']);

// A /compact turn is in flight when the latest top-level `msg.user` is exactly `/compact` and no
// `compact.boundary` has been logged since. The compaction is a black box with no incremental
// progress, so the indicator it drives is indeterminate; the caller adds that the session is
// `running` (architecture.md § Adapter, protocol.md § 5).
const awaitingCompact = (events: readonly FluxEvent[]): boolean => {
  let awaiting = false;
  for (const event of events) {
    if (event.parent !== undefined || !fluxEvent.isKnown(event)) continue;
    if (event.type === 'msg.user') awaiting = event.payload.text.trim() === '/compact';
    else if (event.type === 'compact.boundary') awaiting = false;
  }
  return awaiting;
};

export interface SessionTimeline extends MessageReply {
  tasks: ComputedRef<SessionTask[]>;
  // The rows the strip lists: current tasks (store/session-tasks) and the open chat's task,
  // kept while viewed even when its turn is over.
  strip: ComputedRef<SessionTask[]>;
  // The open chat: null for main, else the task's `toolUseId`.
  view: Ref<string | null>;
  // The open task's row, null on main or once the task is gone (a cleared context).
  task: ComputedRef<SessionTask | null>;
  timeline: ComputedRef<FluxEvent[]>;
  // Rows of the open chat left out of `timeline`; Show earlier brings them in.
  earlier: ComputedRef<number>;
  ask: ComputedRef<EventPayloads['ask'] | null>;
  // A /compact turn with no boundary yet; the screen shows an indeterminate "Compacting…"
  // indicator while this and `running` hold.
  awaitingCompaction: ComputedRef<boolean>;
  select: (view: string | null) => void;
  showEarlier: () => void;
}

export const useSessionTimeline = (events: () => readonly FluxEvent[]): SessionTimeline => {
  const view = ref<string | null>(null);
  const all = ref(false);
  const tasks = computed(() => sessionTasks(events()));
  const task = computed(() => tasks.value.find((t) => t.toolUseId === view.value) ?? null);
  const strip = computed(() => tasks.value.filter((t) => t.current || t.toolUseId === view.value));
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
  const awaitingCompaction = computed(() => awaitingCompact(events()));
  return {
    ...useMessageReply(events),
    tasks,
    strip,
    view,
    task,
    timeline,
    earlier,
    ask,
    awaitingCompaction,
    select: (next) => {
      view.value = next;
      all.value = false;
    },
    showEarlier: () => {
      all.value = true;
    },
  };
};
