<script setup lang="ts">
import { computed } from 'vue';

import type { ReplyTarget } from '../composables/useMessageReply.ts';
import type { PendingComment } from '../store/pending-comments.ts';
import type { PendingAttachment } from '../store/store-state.ts';
import AttachmentChips from './AttachmentChips.vue';
import CommentTray from './CommentTray.vue';
import Icon from './Icon.vue';

// What goes with the next message, in the rows above the box: the comments waiting for it
// (CommentTray), the message it answers when the operator picked Reply on a bubble, and the
// files attached to it (AttachmentChips). Each row can be withdrawn from here; the Composer
// owns the data and the sending.

const props = defineProps<{
  comments: PendingComment[];
  reply: ReplyTarget | null;
  attachments: PendingAttachment[];
}>();
defineEmits<{
  removeComment: [commentId: string];
  unreply: [];
  removeAttachment: [key: string];
  retryAttachment: [key: string];
}>();

const replyLine = computed(
  () => props.reply?.text.split('\n').find((line) => line.trim() !== '') ?? '',
);
const replyWho = computed(() => (props.reply?.from === 'user' ? 'you' : 'the agent'));
</script>

<template>
  <CommentTray :comments="comments" @remove="$emit('removeComment', $event)" />
  <div v-if="reply !== null" class="reply">
    <span class="who">Replying to {{ replyWho }}</span>
    <span class="line">{{ replyLine }}</span>
    <button
      type="button"
      class="secondary icon-only"
      aria-label="Cancel reply"
      title="Cancel reply"
      @click="$emit('unreply')"
    >
      <Icon name="close" />
    </button>
  </div>
  <AttachmentChips
    :attachments="attachments"
    @remove="$emit('removeAttachment', $event)"
    @retry="$emit('retryAttachment', $event)"
  />
</template>

<style scoped>
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
  padding: 0.15rem 0.4rem;
  font-size: 0.9rem;
}
</style>
