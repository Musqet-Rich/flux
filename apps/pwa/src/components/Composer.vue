<script setup lang="ts">
import type { FluxEvent } from '@flux/protocol';
import { computed, ref, watch } from 'vue';

import type { ReplyTarget } from '../composables/useMessageReply.ts';
import type { Store } from '../store/create-store.ts';
import { pendingComments } from '../store/pending-comments.ts';
import CommentTray from './CommentTray.vue';

// The message box at the foot of the session screen, with the comments waiting to go with the
// next message and, when the operator picked Reply on a bubble, the message being answered.
// Sends through the store, which reports failures; a failed send keeps the draft and the reply.

const props = defineProps<{
  store: Store;
  session: string;
  events: readonly FluxEvent[];
  reply: ReplyTarget | null;
}>();
const emit = defineEmits<{ sent: []; unreply: [] }>();

const draft = ref('');
const sending = ref(false);
const box = ref<HTMLTextAreaElement | null>(null);
const pending = computed(() => pendingComments(props.events));
const replyLine = computed(
  () => props.reply?.text.split('\n').find((line) => line.trim() !== '') ?? '',
);
const replyWho = computed(() => (props.reply?.from === 'user' ? 'you' : 'the agent'));

// Picking Reply is the start of typing, so the box takes focus.
watch(
  () => props.reply,
  (reply) => {
    if (reply !== null) box.value?.focus();
  },
);

const send = async (): Promise<void> => {
  const text = draft.value.trim();
  if (text === '' || sending.value) return;
  sending.value = true;
  emit('sent');
  const ok = await props.store.send(props.session, text, props.reply?.seq);
  sending.value = false;
  if (!ok) return;
  draft.value = '';
  if (props.reply !== null) emit('unreply');
};

const remove = (commentId: string): void => {
  void props.store.removeComment(props.session, commentId);
};
</script>

<template>
  <div class="composer">
    <CommentTray :comments="pending" @remove="remove" />
    <div v-if="reply !== null" class="reply">
      <span class="who">Replying to {{ replyWho }}</span>
      <span class="line">{{ replyLine }}</span>
      <button type="button" class="secondary" aria-label="Cancel reply" @click="$emit('unreply')">
        ×
      </button>
    </div>
    <form class="row" @submit.prevent="send">
      <textarea
        ref="box"
        v-model="draft"
        rows="2"
        placeholder="Message the agent"
        @keydown.enter.meta.prevent="send"
        @keydown.enter.ctrl.prevent="send"
      />
      <button type="submit" :disabled="sending || draft.trim() === ''">Send</button>
    </form>
  </div>
</template>

<style scoped>
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

.reply {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.5rem;
  border-left: 2px solid var(--accent);
  background: var(--panel-2);
  border-radius: var(--radius);
  font-size: 0.8rem;
}

.who {
  flex: none;
  color: var(--muted);
}

.line {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reply button {
  padding: 0.1rem 0.5rem;
  line-height: 1;
}
</style>
