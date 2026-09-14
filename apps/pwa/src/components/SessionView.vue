<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import { useFocusChord } from '../composables/useFocusChord.ts';
import { useSessionTimeline } from '../composables/useSessionTimeline.ts';
import type { Store } from '../store/create-store.ts';
import AgentStrip from './AgentStrip.vue';
import Composer from './Composer.vue';
import Icon from './Icon.vue';
import SessionTimeline from './SessionTimeline.vue';
import SessionToolbar from './SessionToolbar.vue';

// One session: its toolbar (SessionToolbar), the agents strip while it has a task row (a lone
// `main` says nothing the toolbar does not), the timeline of the open chat (SessionTimeline:
// main's or one subagent's rows, the streaming reply, the agent's open question) and the
// composer, or on a subagent's chat the note that messages go to main. The store owns the data
// and reports failures; this only renders and dispatches.

// `pane`: the element beside the chat on a wide screen (ADR 0033), whose keys are its own.
const props = defineProps<{ store: Store; session: string; pane?: HTMLElement | null }>();
defineEmits<{ changes: []; files: []; closed: [] }>();

const list = ref<InstanceType<typeof SessionTimeline> | null>(null);
const composer = ref<InstanceType<typeof Composer> | null>(null);
// ⌃⌥M anywhere on the screen puts the caret in the composer, while main's chat has one and
// the device's switch chord is not Off.
const focusHint = useFocusChord(
  computed(() => composer.value?.box ?? null),
  'Message the agent',
  () => props.store.state.switchKey !== 'off',
);

const log = computed(() => props.store.state.logs[props.session]);
const events = computed(() => log.value?.events ?? []);
const chat = useSessionTimeline(() => events.value);
const {
  strip,
  view,
  task,
  timeline,
  earlier,
  ask,
  awaitingCompaction,
  reply,
  quoteOf,
  startReply,
  cancelReply,
  comments,
} = chat;
const streaming = computed(() => log.value?.streaming ?? '');
const thinking = computed(() => log.value?.thinking ?? null);
// "~1.2k tokens" once Claude has reported a count, plain "Thinking…" before that; null when the
// agent is not thinking.
const thinkingText = computed((): string | null => {
  if (thinking.value === null) return null;
  const tokens = thinking.value.estimatedTokens ?? null;
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
// A ~59s black box with nothing to draw a bar from, so this is an indeterminate indicator: a
// running /compact turn on main with no boundary logged yet (useSessionTimeline).
const compacting = computed(() => busy.value && onMain.value && awaitingCompaction.value);
const ended = ref(false);
// Replies go with the composer, which main alone has; a subagent's chat has none to reply from.
const pick = (seq: number): void => {
  if (onMain.value) startReply(seq);
};

// Landing at the tail is also when the window is cut back to size: rows the operator has read
// past need not stay in the DOM, and cutting them above the viewport is invisible because the
// jump sets the scroll from the end once the DOM has changed.
const catchUp = (): void => {
  chat.trim();
  void list.value?.jump();
};

// The composer taking more room takes it from the timeline; at the tail, the end is kept.
const keep = (): void => {
  list.value?.keep();
};

// Switching chats always lands at the end of the one opened.
const select = (next: string | null): void => {
  chat.select(next);
  list.value?.reset();
  catchUp();
};

const answer = (text: string): void => {
  catchUp();
  void props.store.answer(props.session, ask.value?.askId ?? '', text);
};

const interrupt = (): void => {
  void props.store.interrupt(props.session);
};
// Esc stops the agent as the toolbar's Stop does, from anywhere on the screen, the composer
// included, so a turn going wrong is one key away. Whatever is open and closes on Escape (a
// menu, the slash list, the help modal, the Rename…/Delete… forms, the image overlay) marks
// the key consumed, and that one only closes it: this listens on the window, so theirs, on
// elements and the document, have run first. A held key repeats, and one interrupt is all a
// turn needs; an Escape that cancels an IME composition is the IME's. One pressed in the pane
// beside the chat on a wide screen (`pane`, ADR 0033), in the editor say, is the pane's.
const onKey = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape' || event.repeat || event.isComposing) return;
  if (event.defaultPrevented || !busy.value) return;
  if (event.target instanceof Node && props.pane?.contains(event.target) === true) return;
  interrupt();
};

onMounted(() => {
  window.addEventListener('keydown', onKey);
  void props.store.open(props.session);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKey);
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
// Immediate: a session the store already holds (reopened from the list, say) has its rows
// before this mounts, and its thumbnails went when it was left.
watch(
  () => timeline.value,
  (rows) => {
    props.store.loadThumbnails(props.session, rows);
  },
  { immediate: true },
);
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
    <SessionTimeline
      ref="list"
      :rows="timeline"
      :earlier="earlier"
      :quote-of="quoteOf"
      :thumbs="thumbs"
      :on-main="onMain"
      :streaming="streaming"
      :thinking="thinkingText"
      :compacting="compacting"
      :ask="ask"
      @task="select"
      @reply="pick"
      @answer="answer"
      @earlier="chat.showEarlier"
      @trim="chat.trim"
      @reveal="chat.reveal"
      @catch-up="catchUp"
    />
    <Composer
      v-if="onMain"
      ref="composer"
      :store="store"
      :session="session"
      :comments="comments"
      :reply="reply"
      :hint="focusHint"
      @sent="catchUp"
      @unreply="cancelReply"
      @resized="keep"
    />
    <div v-else class="aside">
      <span class="hint">{{ ended ? `Task ${task?.status}. ` : '' }}Messages go to main</span>
      <button
        type="button"
        class="secondary icon-only"
        aria-label="Back to main"
        title="Back to main"
        @click="select(null)"
      >
        <Icon name="back" />
      </button>
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
