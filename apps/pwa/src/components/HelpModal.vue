<script setup lang="ts">
import type { SessionSummary } from '@flux/protocol';
import { computed, onMounted, ref } from 'vue';

import type { Store } from '../store/create-store.ts';

// "Ask about Flux" (ADR 0008): a modal over the app. The operator types a question; Send opens a
// daemon-managed Help session seeded with it and navigates there. Cmd/Ctrl+Enter submits, Escape
// and a tap on the backdrop close it. On failure the modal stays open with the text intact and
// shows the box's message.

const props = defineProps<{ store: Store }>();
const emit = defineEmits<{ created: [session: SessionSummary]; close: [] }>();

const text = ref('');
const busy = ref(false);
const failure = ref<string | null>(null);
const box = ref<HTMLTextAreaElement | null>(null);

const canSend = computed(() => text.value.trim() !== '' && !busy.value);

const close = (): void => {
  emit('close');
};

const submit = async (): Promise<void> => {
  if (!canSend.value) return;
  busy.value = true;
  failure.value = null;
  try {
    const summary = await props.store.createHelpSession(text.value);
    emit('created', summary);
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
};

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    close();
  } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void submit();
  }
};

onMounted(() => {
  box.value?.focus();
});
</script>

<template>
  <div class="backdrop" @click.self="close">
    <div class="modal" role="dialog" aria-modal="true" aria-label="Ask about Flux">
      <label class="label" for="help-question">Ask a question about Flux</label>
      <textarea
        id="help-question"
        ref="box"
        v-model="text"
        rows="4"
        :disabled="busy"
        placeholder="e.g. How do I pair a new device?"
        @keydown="onKeydown"
      />
      <p v-if="failure !== null" class="error">{{ failure }}</p>
      <div class="actions">
        <button type="button" class="secondary" @click="close">Cancel</button>
        <button type="button" :disabled="!canSend" @click="submit">
          {{ busy ? 'Sending…' : 'Send' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: calc(2rem + env(safe-area-inset-top)) 1rem calc(1rem + env(safe-area-inset-bottom));
  background: rgb(0 0 0 / 60%);
}

.modal {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
  max-width: 32rem;
  box-sizing: border-box;
  padding: 1rem;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.label {
  color: var(--muted);
  font-size: 0.85rem;
}

textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.error {
  color: var(--danger);
  margin: 0;
}
</style>
