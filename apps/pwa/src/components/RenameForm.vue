<script setup lang="ts">
import { onMounted, ref } from 'vue';

// The inline form behind "Rename…": the current title, editable, submitted as the new one. The
// box trims and refuses a blank or over-long title (protocol.md § 7), so the submit is disabled
// on a blank one and the input stops at the box's limit rather than sending what it would refuse.

const titleLimit = 200;

const props = defineProps<{ title: string; busy: boolean }>();
const emit = defineEmits<{ confirm: [title: string]; cancel: [] }>();

const draft = ref(props.title);
const input = ref<HTMLInputElement | null>(null);

onMounted(() => {
  input.value?.select();
});

const confirm = (): void => {
  const title = draft.value.trim();
  if (title !== '') emit('confirm', title);
};
const cancel = (): void => {
  emit('cancel');
};
</script>

<template>
  <form class="rename" @submit.prevent="confirm">
    <label class="field">
      <span>Session name</span>
      <input
        ref="input"
        v-model="draft"
        type="text"
        autocomplete="off"
        enterkeyhint="done"
        :maxlength="titleLimit"
      />
    </label>
    <div class="actions">
      <button type="button" class="secondary" @click="cancel">Cancel</button>
      <button type="submit" :disabled="busy || draft.trim() === ''">Rename</button>
    </div>
  </form>
</template>

<style scoped>
.rename {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  color: var(--muted);
}

.field input {
  width: 100%;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
