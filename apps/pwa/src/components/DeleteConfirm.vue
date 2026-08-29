<script setup lang="ts">
import { ref } from 'vue';

import type { DeleteOptions } from '../store/session-actions.ts';

// The inline confirm behind "Delete…": what to remove, then, when the box refuses because the
// worktree holds work that exists nowhere else (`dirty`), the same request again with the
// box's counts and an explicit "Discard changes".

const props = defineProps<{ dirty: string | null; busy: boolean }>();
const emit = defineEmits<{ confirm: [options: DeleteOptions]; cancel: [] }>();

const removeWorktree = ref(true);
const deleteBranch = ref(false);

const confirm = (discard: boolean): void => {
  emit('confirm', {
    removeWorktree: removeWorktree.value,
    deleteBranch: deleteBranch.value && removeWorktree.value,
    discard,
  });
};
const cancel = (): void => {
  emit('cancel');
};
</script>

<template>
  <form class="confirm" @submit.prevent="confirm(props.dirty !== null)">
    <template v-if="dirty === null">
      <p class="question">Delete this session?</p>
      <label class="option">
        <input v-model="removeWorktree" type="checkbox" />
        Remove worktree
      </label>
      <label class="option">
        <input v-model="deleteBranch" type="checkbox" :disabled="!removeWorktree" />
        Delete branch
      </label>
    </template>
    <p v-else class="question dirty">{{ dirty }}. Discard it?</p>
    <div class="actions">
      <button type="button" class="secondary" @click="cancel">Cancel</button>
      <button type="submit" class="danger" :disabled="busy">
        {{ dirty === null ? 'Delete' : 'Discard changes' }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.confirm {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.question {
  margin: 0;
}

.dirty {
  color: var(--warn);
}

.option {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--muted);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.danger {
  background: var(--danger);
  color: var(--accent-fg);
}
</style>
