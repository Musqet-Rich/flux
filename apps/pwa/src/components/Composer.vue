<script setup lang="ts">
import type { FluxEvent } from '@flux/protocol';
import { computed, ref } from 'vue';

import type { Store } from '../store/create-store.ts';
import { pendingComments } from '../store/pending-comments.ts';
import CommentTray from './CommentTray.vue';

// The message box at the foot of the session screen, with the comments waiting to go with the
// next message. Sends through the store, which reports failures; a failed send keeps the draft.

const props = defineProps<{ store: Store; session: string; events: readonly FluxEvent[] }>();
const emit = defineEmits<{ sent: [] }>();

const draft = ref('');
const sending = ref(false);
const pending = computed(() => pendingComments(props.events));

const send = async (): Promise<void> => {
  const text = draft.value.trim();
  if (text === '' || sending.value) return;
  sending.value = true;
  emit('sent');
  const ok = await props.store.send(props.session, text);
  sending.value = false;
  if (ok) draft.value = '';
};

const remove = (commentId: string): void => {
  void props.store.removeComment(props.session, commentId);
};
</script>

<template>
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
</style>
