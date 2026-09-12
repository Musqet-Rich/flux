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
// Main shows top-level rows only; a subagent's chat shows the rows whose `parent` is its call.
// Either chat renders a window of its rows, not all of them: a day's session runs to thousands,
// and every row is a Markdown tree in the DOM. `trim` cuts the window to the last `windowSize`
// rows, and the screen calls it when the operator is at the tail, so the window slides with new
// rows while they are read live and holds its top edge while the operator is scrolled up, so
// the rows they are reading are not removed under them. Show earlier widens it by `pageSize` a
// tap at a time, a deliberate trade: the whole history in one tap is the DOM this exists to
// avoid, at the cost of a long scroll-back and of find-in-page over rows outside the window.
// `reveal` widens it to a given row so a reply chip can scroll to what it quotes, which can
// take in a lot of history for a quote from long ago; the next trim at the tail cuts it back.
// No virtualisation: the rows in the window are all in the DOM. The reply state
// (useMessageReply) rides along so the screen has one object for what its log means.

const windowSize = 300;
const pageSize = 200;

// Agent lines Flux does not read (`raw`), rate-limit changes and `files.changed` stay in the log
// for the ask, comment, sync and Changes logic, but they are noise on a phone: hooks and streaming
// envelopes would put half a dozen bare rows around every reply, a subagent repeats `files.changed`
// on every write, and the status bar and Changes button already carry what they say.
// `task.progress` only feeds the agents strip, `agent.spec` the toolbar's chip.
const hiddenTypes = new Set(['raw', 'rate_limit', 'files.changed', 'task.progress', 'agent.spec']);

// A /compact turn is in flight when the latest top-level `msg.user` is `/compact` — bare, or with
// a focus argument (a self-compaction via the flux_compact tool queues `/compact <focus>`) — and no
// `compact.boundary` has been logged since. The compaction is a black box with no incremental
// progress, so the indicator it drives is indeterminate; the caller adds that the session is
// `running` (architecture.md § Adapter, protocol.md § 5).
const awaitingCompact = (events: readonly FluxEvent[]): boolean => {
  let awaiting = false;
  for (const event of events) {
    if (event.parent !== undefined || !fluxEvent.isKnown(event)) continue;
    if (event.type === 'msg.user') {
      const text = event.payload.text.trim();
      awaiting = text === '/compact' || text.startsWith('/compact ');
    } else if (event.type === 'compact.boundary') awaiting = false;
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
  // Rows of the open chat left out of the top of `timeline`; Show earlier brings them in.
  earlier: ComputedRef<number>;
  ask: ComputedRef<EventPayloads['ask'] | null>;
  // A /compact turn with no boundary yet; the screen shows an indeterminate "Compacting…"
  // indicator while this and `running` hold.
  awaitingCompaction: ComputedRef<boolean>;
  select: (view: string | null) => void;
  showEarlier: () => void;
  // Cuts the window back to the last `windowSize` rows.
  trim: () => void;
  // Widens the window to take in the row with this seq, if the chat has it.
  reveal: (seq: number) => void;
}

export const useSessionTimeline = (events: () => readonly FluxEvent[]): SessionTimeline => {
  const view = ref<string | null>(null);
  // How many rows the window leaves out at the top. A count, not a seq: rows only ever append,
  // so a fixed count holds the top edge still while the tail grows.
  const hidden = ref(0);
  const tasks = computed(() => sessionTasks(events()));
  const task = computed(() => tasks.value.find((t) => t.toolUseId === view.value) ?? null);
  const strip = computed(() => tasks.value.filter((t) => t.current || t.toolUseId === view.value));
  const rows = computed(() =>
    events().filter((e) => !hiddenTypes.has(e.type) && (e.parent ?? null) === view.value),
  );
  const earlier = computed(() => Math.min(hidden.value, rows.value.length));
  const timeline = computed(() =>
    earlier.value === 0 ? rows.value : rows.value.slice(earlier.value),
  );
  const trim = (): void => {
    hidden.value = Math.max(0, rows.value.length - windowSize);
  };
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
      trim();
    },
    showEarlier: () => {
      hidden.value = Math.max(0, earlier.value - pageSize);
    },
    trim,
    reveal: (seq) => {
      const index = rows.value.findIndex((e) => e.seq === seq);
      if (index !== -1) hidden.value = Math.min(hidden.value, index);
    },
  };
};
