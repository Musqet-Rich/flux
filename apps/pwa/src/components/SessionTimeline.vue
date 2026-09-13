<script setup lang="ts">
import type { EventPayloads, FluxEvent } from '@flux/protocol';
import { computed, nextTick, ref, watch } from 'vue';

import { useTailScroll } from '../composables/useTailScroll.ts';
import AskCard from './AskCard.vue';
import EventItem from './EventItem.vue';
import { foldToolRuns } from './fold-tool-runs.ts';
import Icon from './Icon.vue';
import LiveBubble from './LiveBubble.vue';

// The scrolling middle of the session screen: a Show earlier button, the rows of the open chat
// (each run of past tool calls behind one disclosure, foldToolRuns), the main agent's live
// bubble, the open question, and the catch-up pill. It follows new content only while the
// operator is at the tail; scrolled up, the pill counts what arrived and the view stays put
// (useTailScroll). The parent owns the data, the chat selection and the window of rows
// (useSessionTimeline): this says when to `trim` it (new rows landing at the tail, a catch-up)
// and when to `reveal` a row (a reply chip), and is asked to `jump` to the end (a send, an
// answer, a chat switch, after the parent has trimmed), to `keep` the tail as the composer grows
// and to `reset` the tail state.

const props = defineProps<{
  rows: FluxEvent[];
  earlier: number;
  quoteOf: (event: FluxEvent) => string | null | undefined;
  thumbs: Record<string, string>;
  // Main's chat: the live bubble shows and the pill follows streaming text; a subagent's has none.
  onMain: boolean;
  streaming: string;
  thinking: string | null;
  compacting: boolean;
  ask: EventPayloads['ask'] | null;
}>();
const emit = defineEmits<{
  task: [toolUseId: string];
  reply: [seq: number];
  answer: [text: string];
  earlier: [];
  // Cut the window back to size (the operator is at the tail) and widen it to a row.
  trim: [];
  reveal: [seq: number];
  // The pill: the parent trims, then asks for the jump.
  catchUp: [];
}>();

const tail = useTailScroll();
const { scroller, behind, unread } = tail;

// Past tool runs fold, but not under an operator scrolled up into them: from the moment new
// rows land while they are scrolled up, everything from the last row they had stays flat, so
// the rows they are reading (a tool detail they opened, say) do not collapse into one line and
// drop the view to the tail. Reaching the tail again, by a scroll, a jump or a reset, lifts it,
// which is also when runs that landed below the viewport meanwhile fold, all at once.
const hold = ref<number | null>(null);
const entries = computed(() => foldToolRuns(props.rows, hold.value));
watch(
  () => tail.atTail.value,
  (at) => {
    if (at) hold.value = null;
  },
);

const pill = computed(() => (unread.value > 0 ? `${unread.value} new` : 'New activity'));

// Scrolls the quoted message into view, first having the parent widen the window to it when it
// has slid out of the top (the emit is handled synchronously, so the next tick has the row); a
// source the log lacks leaves the scroll where it is. Only messages are quoted, and a message
// is never inside a fold, so the row always has a box to scroll to.
const showQuoted = async (seq: number): Promise<void> => {
  emit('reveal', seq);
  await nextTick();
  scroller.value?.querySelector(`[data-seq="${seq}"]`)?.scrollIntoView({ block: 'center' });
};
const jumpTo = (seq: number): void => {
  void showQuoted(seq);
};

// New rows follow one rule: at the tail the window slides with them (the parent trims), scrolled
// up it holds and the pill counts them, so nothing being read moves or vanishes. The measure
// here only decides the trim; `follow` measures again for itself.
const arrived = async (added: number, shown: number): Promise<void> => {
  tail.measure();
  if (tail.atTail.value) emit('trim');
  else hold.value ??= shown;
  await tail.follow(added);
};

// Only rows newer than the last one shown count as new: Show earlier prepends rows, a trim cuts
// them and a chat switch swaps them, and none is activity to follow or to put on the pill.
watch(
  () => props.rows,
  (rows, before) => {
    const last = before.at(-1)?.seq ?? 0;
    const added = rows.filter((row) => row.seq > last).length;
    if (added > 0) void arrived(added, last);
  },
);
// Only growth counts: the text emptying is the reply landing, and that event is counted above.
watch(
  () => props.streaming,
  (text) => {
    if (text !== '' && props.onMain) void tail.follow(0);
  },
);
watch(
  () => props.thinking,
  (text) => {
    if (text !== null && props.onMain) void tail.follow(0);
  },
);

// The composer growing takes its room from the bottom of this list, hiding the last lines
// from an operator at the tail; a jump puts them back. `atTail` is the last scroll's reading,
// not re-measured, since the shrunk viewport would read as scrolled up.
const keep = (): void => {
  if (tail.atTail.value) void tail.jump();
};
defineExpose({ jump: tail.jump, reset: tail.reset, keep });
</script>

<template>
  <div class="log">
    <div ref="scroller" class="timeline" @scroll="tail.measure">
      <button v-if="earlier > 0" type="button" class="secondary earlier" @click="$emit('earlier')">
        Show {{ earlier }} earlier
      </button>
      <template v-for="entry in entries" :key="entry.seq">
        <details v-if="entry.kind === 'fold'" class="fold" :class="entry.tone">
          <summary><Icon name="forward" class="caret" /> {{ entry.text }}</summary>
          <!-- Tool rows quote nothing, carry no attachments and emit nothing: the event is all. -->
          <div class="folded">
            <EventItem v-for="row in entry.rows" :key="row.seq" :event="row" />
          </div>
        </details>
        <EventItem
          v-else
          :event="entry.row"
          :quote="quoteOf(entry.row) ?? null"
          :thumbs="thumbs"
          @task="$emit('task', $event)"
          @reply="$emit('reply', $event)"
          @jump="jumpTo"
        />
      </template>
      <LiveBubble
        v-if="onMain"
        :streaming="streaming"
        :thinking="thinking"
        :compacting="compacting"
      />
      <AskCard v-if="ask !== null" :key="ask.askId" :ask="ask" @answer="$emit('answer', $event)" />
    </div>
    <button v-if="behind" type="button" class="new-activity" @click="$emit('catchUp')">
      <Icon name="down" /> {{ pill }}
    </button>
  </div>
</template>

<style scoped>
.log {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.timeline {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* Rows wrap their own long tokens; tables scroll in their own wrapper. */
  overflow-x: hidden;
  overflow-anchor: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
}

.earlier {
  align-self: center;
  font-size: 0.85rem;
}

/* A fold's line sits where its rows sat and reads like them: the same muted monospace as a tool
   row's summary, red when a call in it failed, with its own caret in place of the browser's
   marker (which would indent the text past the rows around it, and which Safari only hides
   through its prefixed pseudo-element). Its rows keep the timeline's own spacing. */
.fold {
  align-self: stretch;
}

.fold summary {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  list-style: none;
  cursor: pointer;
  padding: 0.15rem 0;
  color: var(--muted);
  font-family: var(--font-code);
  font-size: 0.8rem;
}

.fold summary::-webkit-details-marker {
  display: none;
}

.caret {
  transition: transform 0.15s;
}

.fold[open] .caret {
  transform: rotate(90deg);
}

@media (prefers-reduced-motion: reduce) {
  .caret {
    transition: none;
  }
}

.fold.error summary {
  color: var(--danger);
}

.folded {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.new-activity {
  position: absolute;
  bottom: 0.75rem;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.35rem 0.9rem;
  border-radius: 999px;
  font-size: 0.85rem;
  box-shadow: 0 2px 8px rgb(0 0 0 / 30%);
}
</style>
