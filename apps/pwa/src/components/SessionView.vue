<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import type { Store } from '../store/create-store.ts';
import { openAsk } from '../store/open-ask.ts';
import { pendingComments } from '../store/pending-comments.ts';
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
const scroller = ref<HTMLElement | null>(null);

const log = computed(() => props.store.state.logs[props.session]);
const events = computed(() => log.value?.events ?? []);
// Agent lines Flux does not read (`raw`) and rate-limit changes stay in the log for the ask,
// comment and sync logic, but they are noise on a phone: hooks and streaming envelopes would
// put half a dozen bare rows around every reply, and the status bar already shows the windows.
const timeline = computed(() => events.value.filter((e) => !hiddenTypes.has(e.type)));
const streaming = computed(() => log.value?.streaming ?? '');
const ask = computed(() => openAsk(events.value));
const pending = computed(() => pendingComments(events.value));
const summary = computed(() => props.store.state.sessions.find((s) => s.session === props.session));
const busy = computed(() => summary.value?.state === 'running');

const scrollToEnd = async (): Promise<void> => {
  await nextTick();
  const el = scroller.value;
  if (el !== null) el.scrollTop = el.scrollHeight;
};

const send = async (): Promise<void> => {
  const text = draft.value.trim();
  if (text === '' || sending.value) return;
  sending.value = true;
  const ok = await props.store.send(props.session, text);
  sending.value = false;
  if (ok) draft.value = '';
};

const answer = (text: string): void => {
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
    void props.store.open(session);
  },
);
watch([() => events.value.length, streaming], () => {
  void scrollToEnd();
});
</script>

<template>
  <section class="session">
    <div class="toolbar">
      <span class="branch">{{ summary?.branch ?? session }}</span>
      <button v-if="busy" type="button" class="secondary" @click="interrupt">Stop</button>
      <button type="button" class="secondary" @click="$emit('changes')">Changes</button>
    </div>
    <div ref="scroller" class="timeline">
      <EventItem v-for="e in timeline" :key="e.seq" :event="e" />
      <article v-if="streaming !== ''" class="streaming">
        <pre>{{ streaming }}</pre>
      </article>
      <AskCard v-if="ask !== null" :key="ask.askId" :ask="ask" @answer="answer" />
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

.timeline {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
}

.streaming {
  align-self: flex-start;
  background: var(--panel-2);
  border-radius: var(--radius);
  padding: 0.6rem 0.8rem;
  max-width: 85%;
  opacity: 0.8;
}

.streaming pre {
  font: inherit;
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
