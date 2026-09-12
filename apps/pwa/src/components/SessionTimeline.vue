<script setup lang="ts">
import type { EventPayloads, FluxEvent } from '@flux/protocol';
import { computed, nextTick, watch } from 'vue';

import { useTailScroll } from '../composables/useTailScroll.ts';
import AskCard from './AskCard.vue';
import EventItem from './EventItem.vue';
import Icon from './Icon.vue';
import LiveBubble from './LiveBubble.vue';

// The scrolling middle of the session screen: a Show earlier button, the rows of the open chat,
// the main agent's live bubble, the open question, and the catch-up pill. It follows new content
// only while the operator is at the tail; scrolled up, the pill counts what arrived and the view
// stays put (useTailScroll). The parent owns the data, the chat selection and the window of rows
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

const pill = computed(() => (unread.value > 0 ? `${unread.value} new` : 'New activity'));

// Scrolls the quoted message into view, first having the parent widen the window to it when it
// has slid out of the top (the emit is handled synchronously, so the next tick has the row); a
// source the log lacks leaves the scroll where it is.
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
const arrived = async (added: number): Promise<void> => {
  tail.measure();
  if (tail.atTail.value) emit('trim');
  await tail.follow(added);
};

// Only rows newer than the last one shown count as new: Show earlier prepends rows, a trim cuts
// them and a chat switch swaps them, and none is activity to follow or to put on the pill.
watch(
  () => props.rows,
  (rows, before) => {
    const last = before.at(-1)?.seq ?? 0;
    const added = rows.filter((row) => row.seq > last).length;
    if (added > 0) void arrived(added);
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
      <EventItem
        v-for="e in rows"
        :key="e.seq"
        :event="e"
        :quote="quoteOf(e) ?? null"
        :thumbs="thumbs"
        @task="$emit('task', $event)"
        @reply="$emit('reply', $event)"
        @jump="jumpTo"
      />
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
