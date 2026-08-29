<script setup lang="ts">
import type { FluxEvent } from '@flux/protocol';
import { computed, ref, watch } from 'vue';

import type { ReplyTarget } from '../composables/useMessageReply.ts';
import { useFileDrop } from '../composables/useFileDrop.ts';
import type { Store } from '../store/create-store.ts';
import { pendingComments } from '../store/pending-comments.ts';
import AttachmentChips from './AttachmentChips.vue';
import CommentTray from './CommentTray.vue';

// The message box at the foot of the session screen, with the comments waiting to go with the
// next message, the files attached to it (a + button, a drop on the bottom bar, or a paste)
// and, when the operator picked Reply on a bubble, the message being answered. The draft, text
// and files, lives in the store so leaving the session keeps it. Sends through the store,
// which reports failures; a failed send keeps the draft and the reply.

const props = defineProps<{
  store: Store;
  session: string;
  events: readonly FluxEvent[];
  reply: ReplyTarget | null;
}>();
const emit = defineEmits<{ sent: []; unreply: [] }>();

const draft = computed(() => props.store.composer(props.session));
const sending = ref(false);
const box = ref<HTMLTextAreaElement | null>(null);
const root = ref<HTMLElement | null>(null);
const picker = ref<HTMLInputElement | null>(null);
const pending = computed(() => pendingComments(props.events));
const replyLine = computed(
  () => props.reply?.text.split('\n').find((line) => line.trim() !== '') ?? '',
);
const replyWho = computed(() => (props.reply?.from === 'user' ? 'you' : 'the agent'));
// Every file must be on the box before the message that names them goes.
const uploading = computed(() => draft.value.attachments.some((a) => a.status !== 'ready'));
const blank = computed(() => draft.value.text.trim() === '');

const add = (files: File[]): void => {
  props.store.attach(props.session, files);
};
// The status bar is the other half of the bottom bar; it belongs to Shell, hence the lookup.
const bar = (): (Element | null)[] => [root.value, document.querySelector('footer.bar')];
const drop = useFileDrop(bar, add);

const pick = (event: Event): void => {
  const input = event.target instanceof HTMLInputElement ? event.target : null;
  add(Array.from(input?.files ?? []));
  if (input !== null) input.value = '';
};
// Files on the clipboard become attachments; a text paste is the browser's as before.
const paste = (event: Event): void => {
  const files = drop.filesOf(event);
  if (files.length === 0) return;
  event.preventDefault();
  add(files);
};

// Picking Reply is the start of typing, so the box takes focus.
watch(
  () => props.reply,
  (reply) => {
    if (reply !== null) box.value?.focus();
  },
);

const send = async (): Promise<void> => {
  const text = draft.value.text.trim();
  if (text === '' || sending.value || uploading.value) return;
  sending.value = true;
  emit('sent');
  const ok = await props.store.send(props.session, text, props.reply?.seq);
  sending.value = false;
  if (!ok) return;
  if (props.reply !== null) emit('unreply');
};

const remove = (commentId: string): void => {
  void props.store.removeComment(props.session, commentId);
};
</script>

<template>
  <div ref="root" class="composer" :class="{ over: drop.over.value }">
    <CommentTray :comments="pending" @remove="remove" />
    <div v-if="reply !== null" class="reply">
      <span class="who">Replying to {{ replyWho }}</span>
      <span class="line">{{ replyLine }}</span>
      <button type="button" class="secondary" aria-label="Cancel reply" @click="$emit('unreply')">
        ×
      </button>
    </div>
    <AttachmentChips
      :attachments="draft.attachments"
      @remove="store.removeAttachment(session, $event)"
      @retry="store.retryAttachment(session, $event)"
    />
    <form class="row" @submit.prevent="send">
      <input ref="picker" type="file" multiple class="picker" aria-hidden="true" @change="pick" />
      <button
        type="button"
        class="secondary attach"
        aria-label="Attach files"
        title="Attach files"
        @click="picker?.click()"
      >
        +
      </button>
      <textarea
        ref="box"
        v-model="draft.text"
        rows="2"
        placeholder="Message the agent"
        @keydown.enter.meta.prevent="send"
        @keydown.enter.ctrl.prevent="send"
        @paste="paste"
      />
      <button type="submit" :disabled="sending || blank || uploading">Send</button>
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

.picker {
  display: none;
}

.attach {
  flex: none;
  font-size: 1.2rem;
  line-height: 1;
  padding: 0.45rem 0.7rem;
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
