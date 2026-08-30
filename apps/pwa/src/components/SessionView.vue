<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import { useSessionTimeline } from '../composables/useSessionTimeline.ts';
import { useTailScroll } from '../composables/useTailScroll.ts';
import { renderMarkdown } from '../markdown/render-markdown.ts';
import type { Store } from '../store/create-store.ts';
import AgentStrip from './AgentStrip.vue';
import AskCard from './AskCard.vue';
import Composer from './Composer.vue';
import EventItem from './EventItem.vue';
import SessionToolbar from './SessionToolbar.vue';

// One session: its toolbar (SessionToolbar), the agents strip while it has a task row (a lone
// `main` says nothing the toolbar does not), the
// timeline of the open chat (main, or one subagent's), the streaming reply, the agent's open
// question and the composer. The store owns the data and reports failures; this only renders
// and dispatches.

const props = defineProps<{ store: Store; session: string }>();
defineEmits<{ changes: []; files: []; closed: [] }>();

// The timeline follows new content only while the operator is at the tail; scrolled up, a pill
// counts what arrived and the view stays put (useTailScroll).
const tail = useTailScroll();
const { scroller, behind, unread } = tail;

const log = computed(() => props.store.state.logs[props.session]);
const events = computed(() => log.value?.events ?? []);
const chat = useSessionTimeline(() => events.value);
const { strip, view, task, timeline, earlier, ask, reply, quoteOf, startReply, cancelReply } = chat;
const streaming = computed(() => log.value?.streaming ?? '');
// The delta buffer renders through the same Markdown pass as the final message, so an open
// fence is a code block from its first line and the bubble never flickers back to raw text.
const Streaming = (): ReturnType<typeof renderMarkdown> => renderMarkdown(streaming.value);
const thinking = computed(() => log.value?.thinking ?? null);
// "~1.2k tokens" once Claude has reported a count, plain "Thinking…" before that.
const thinkingText = computed(() => {
  const tokens = thinking.value?.estimatedTokens ?? null;
  if (tokens === null) return 'Thinking…';
  const label = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
  return `Thinking… ~${label} tokens`;
});
const summary = computed(() => props.store.state.sessions.find((s) => s.session === props.session));
// Image attachments on sent messages get their thumbnails fetched as their rows appear; the
// blob URLs are the store's and go when this screen leaves the session (ADR 0020).
const thumbs = computed(() => props.store.state.thumbs);
const busy = computed(() => summary.value?.state === 'running');
// The streaming bubble and the thinking indicator are the main agent's (architecture.md
// § Adapter: a subagent's ephemerals are dropped), so they show on main only.
const onMain = computed(() => view.value === null);
const ended = ref(false);
// Replies go with the composer, which main alone has; a subagent's chat has none to reply from.
const pick = (seq: number): void => {
  if (onMain.value) startReply(seq);
};
// Scrolls the quoted message into view. Replies are main-only and main shows every row (the
// last-200 cut applies to subagent chats alone), so the source is rendered whenever the log
// has it; a source the log lacks leaves the scroll where it is.
const jump = (seq: number): void => {
  scroller.value?.querySelector(`[data-seq="${seq}"]`)?.scrollIntoView({ block: 'center' });
};

const pill = computed(() => (unread.value > 0 ? `↓ ${unread.value} new` : '↓ New activity'));

// Switching chats always lands at the end of the one opened.
const select = (next: string | null): void => {
  chat.select(next);
  tail.reset();
  void tail.jump();
};

const answer = (text: string): void => {
  void tail.jump();
  void props.store.answer(props.session, ask.value?.askId ?? '', text);
};

const interrupt = (): void => {
  void props.store.interrupt(props.session);
};

onMounted(() => {
  void props.store.open(props.session);
});
onUnmounted(() => {
  props.store.leave(props.session);
});
watch(
  () => props.session,
  (session, before) => {
    props.store.leave(before);
    select(null);
    cancelReply();
    void props.store.open(session);
  },
);
// Only rows newer than the last one shown count as new: Show earlier prepends rows and a chat
// switch swaps them, and neither is activity to follow or to put on the pill.
watch(
  () => timeline.value,
  (rows, before) => {
    const last = before.at(-1)?.seq ?? 0;
    const added = rows.filter((row) => row.seq > last).length;
    if (added > 0) void tail.follow(added);
  },
);
// Immediate: a session the store already holds (reopened from the list, say) has its rows
// before this mounts, and its thumbnails went when it was left.
watch(
  () => timeline.value,
  (rows) => {
    props.store.loadThumbnails(props.session, rows);
  },
  { immediate: true },
);
// Only growth counts: the text emptying is the reply landing, and that event is counted above.
watch(streaming, (text) => {
  if (text !== '' && onMain.value) void tail.follow(0);
});
watch(thinking, (state) => {
  if (state !== null && onMain.value) void tail.follow(0);
});
// A task that ends while its chat is open is said so once, where the composer would be.
watch(
  () => task.value?.status,
  (status) => {
    ended.value = status !== undefined && status !== 'running';
  },
);
</script>

<template>
  <section class="session">
    <SessionToolbar
      :store="store"
      :session="session"
      :events="events"
      :branch="summary?.branch ?? session"
      :busy="busy"
      @interrupt="interrupt"
      @changes="$emit('changes')"
      @files="$emit('files')"
      @closed="$emit('closed')"
    />
    <AgentStrip
      v-if="strip.length > 0"
      :tasks="strip"
      :active="view"
      :busy="busy"
      @select="select"
    />
    <div class="log">
      <div ref="scroller" class="timeline" @scroll="tail.measure">
        <button
          v-if="earlier > 0"
          type="button"
          class="secondary earlier"
          @click="chat.showEarlier"
        >
          Show {{ earlier }} earlier
        </button>
        <EventItem
          v-for="e in timeline"
          :key="e.seq"
          :event="e"
          :quote="quoteOf(e) ?? null"
          :thumbs="thumbs"
          @task="select"
          @reply="pick"
          @jump="jump"
        />
        <article v-if="onMain && (streaming !== '' || thinking !== null)" class="streaming">
          <Streaming v-if="streaming !== ''" />
          <span v-else class="thinking"
            ><span class="loader" aria-hidden="true" />{{ thinkingText }}</span
          >
        </article>
        <AskCard v-if="ask !== null" :key="ask.askId" :ask="ask" @answer="answer" />
      </div>
      <button v-if="behind" type="button" class="new-activity" @click="tail.jump">
        {{ pill }}
      </button>
    </div>
    <Composer
      v-if="onMain"
      :store="store"
      :session="session"
      :events="events"
      :reply="reply"
      @sent="tail.jump"
      @unreply="cancelReply"
    />
    <div v-else class="aside">
      <span class="hint">{{ ended ? `Task ${task?.status}. ` : '' }}Messages go to main</span>
      <button type="button" class="secondary" @click="select(null)">Back</button>
    </div>
  </section>
</template>

<style scoped>
.session {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

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

.streaming {
  align-self: flex-start;
  background: var(--panel-2);
  border-radius: var(--radius);
  padding: 0.6rem 0.8rem;
  max-width: 85%;
  opacity: 0.8;
}

.thinking {
  color: var(--muted);
  font-style: italic;
}

.thinking .loader {
  margin-right: 0.5rem;
}

.aside {
  flex: none;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--border);
  background: var(--panel);
}

.hint {
  flex: 1;
  color: var(--muted);
  font-size: 0.85rem;
}
</style>
