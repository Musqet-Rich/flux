<script setup lang="ts">
import type { VNode } from 'vue';
import { computed, onMounted, ref, watch } from 'vue';

import { useTailScroll } from '../composables/useTailScroll.ts';
import { renderMarkdown } from '../markdown/render-markdown.ts';
import type { Store } from '../store/create-store.ts';
import { openAsk } from '../store/open-ask.ts';
import { pendingComments } from '../store/pending-comments.ts';
import { sessionPr } from '../store/session-pr.ts';
import AskCard from './AskCard.vue';
import CommentTray from './CommentTray.vue';
import EventItem from './EventItem.vue';

// One session: its timeline, the streaming reply, the agent's open question, the comments
// waiting to go and the composer. The store owns the data and reports failures; this only
// renders and dispatches.

const props = defineProps<{ store: Store; session: string }>();
defineEmits<{ changes: [] }>();

const hiddenTypes = new Set(['raw', 'rate_limit']);
const draft = ref('');
const sending = ref(false);
// The timeline follows new content only while the operator is at the tail; scrolled up, a pill
// counts what arrived and the view stays put (useTailScroll).
const tail = useTailScroll();
const { scroller, behind, unread } = tail;

const log = computed(() => props.store.state.logs[props.session]);
const events = computed(() => log.value?.events ?? []);
// Agent lines Flux does not read (`raw`) and rate-limit changes stay in the log for the ask,
// comment and sync logic, but they are noise on a phone: hooks and streaming envelopes would
// put half a dozen bare rows around every reply, and the status bar already shows the windows.
const timeline = computed(() => events.value.filter((e) => !hiddenTypes.has(e.type)));
const streaming = computed(() => log.value?.streaming ?? '');
// The delta buffer renders through the same Markdown pass as the final message, so an open
// fence is a code block from its first line and the bubble never flickers back to raw text.
const Streaming = (): VNode => renderMarkdown(streaming.value);
const thinking = computed(() => log.value?.thinking ?? null);
// "~1.2k tokens" once Claude has reported a count, plain "Thinking…" before that.
const thinkingText = computed(() => {
  const tokens = thinking.value?.estimatedTokens ?? null;
  if (tokens === null) return 'Thinking…';
  const label = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
  return `Thinking… ~${label} tokens`;
});
const pr = computed(() => sessionPr(events.value));
const prLabel = computed(() =>
  pr.value?.identifier === '' ? 'PR' : `PR #${pr.value?.identifier}`,
);
const ask = computed(() => openAsk(events.value));
const pending = computed(() => pendingComments(events.value));
const summary = computed(() => props.store.state.sessions.find((s) => s.session === props.session));
const busy = computed(() => summary.value?.state === 'running');

const pill = computed(() => (unread.value > 0 ? `↓ ${unread.value} new` : '↓ New activity'));

const send = async (): Promise<void> => {
  const text = draft.value.trim();
  if (text === '' || sending.value) return;
  sending.value = true;
  void tail.jump();
  const ok = await props.store.send(props.session, text);
  sending.value = false;
  if (ok) draft.value = '';
};

const answer = (text: string): void => {
  void tail.jump();
  void props.store.answer(props.session, ask.value?.askId ?? '', text);
};

const remove = (commentId: string): void => {
  void props.store.removeComment(props.session, commentId);
};

const interrupt = (): void => {
  void props.store.interrupt(props.session);
};

onMounted(() => {
  void props.store.open(props.session);
});
watch(
  () => props.session,
  (session) => {
    tail.reset();
    void props.store.open(session);
  },
);
watch(
  () => timeline.value.length,
  (count, before) => {
    void tail.follow(Math.max(0, count - before));
  },
);
// Only growth counts: the text emptying is the reply landing, and that event is counted above.
watch(streaming, (text) => {
  if (text !== '') void tail.follow(0);
});
watch(thinking, (state) => {
  if (state !== null) void tail.follow(0);
});
</script>

<template>
  <section class="session">
    <div class="toolbar">
      <span class="branch">{{ summary?.branch ?? session }}</span>
      <a v-if="pr !== null" class="pr" :href="pr.url" target="_blank" rel="noopener noreferrer">{{
        prLabel
      }}</a>
      <button v-if="busy" type="button" class="secondary" @click="interrupt">Stop</button>
      <button type="button" class="secondary" @click="$emit('changes')">Changes</button>
    </div>
    <div class="log">
      <div ref="scroller" class="timeline" @scroll="tail.measure">
        <EventItem v-for="e in timeline" :key="e.seq" :event="e" />
        <article v-if="streaming !== '' || thinking !== null" class="streaming">
          <Streaming v-if="streaming !== ''" />
          <span v-else class="thinking">{{ thinkingText }}</span>
        </article>
        <AskCard v-if="ask !== null" :key="ask.askId" :ask="ask" @answer="answer" />
      </div>
      <button v-if="behind" type="button" class="new-activity" @click="tail.jump">
        {{ pill }}
      </button>
    </div>
    <div class="composer">
      <CommentTray :comments="pending" @remove="remove" />
      <form class="row" @submit.prevent="send">
        <textarea
          v-model="draft"
          rows="2"
          placeholder="Message the agent"
          @keydown.enter.meta.prevent="send"
          @keydown.enter.ctrl.prevent="send"
        />
        <button type="submit" :disabled="sending || draft.trim() === ''">Send</button>
      </form>
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

.toolbar {
  flex: none;
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--border);
}

.branch {
  flex: 1;
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.pr {
  flex: none;
  color: var(--accent);
  font-size: 0.85rem;
  text-decoration: none;
}

.composer {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--border);
  background: var(--panel);
}

.row {
  display: flex;
  gap: 0.5rem;
  align-items: flex-end;
}
</style>
