<script setup lang="ts">
import { onMounted, ref } from 'vue';

import { useEscape } from '../composables/useEscape.ts';
import type { Spec } from '../store/session-actions.ts';
import { specHints } from './spec-hints.ts';

// The sheet behind "Model & effort…" (ADR 0032): the session's configured model and effort,
// editable, sent as the ones to restart with. Each input starts as the session has it, so what
// the operator leaves alone is not sent and stays; one emptied is sent as null, which clears it
// to the box's default; both left alone is a plain restart. Loose free-text with hints, like
// the create form. Escape cancels (useEscape).

const props = defineProps<{
  model: string | undefined;
  effort: string | undefined;
  busy: boolean;
}>();
const emit = defineEmits<{ confirm: [spec: Spec]; cancel: [] }>();

const model = ref(props.model ?? '');
const effort = ref(props.effort ?? '');
const input = ref<HTMLInputElement | null>(null);

onMounted(() => {
  input.value?.select();
});

// Absent when unchanged, null when emptied, the trimmed text otherwise.
const change = (draft: string, was: string | undefined): string | null | undefined => {
  const trimmed = draft.trim();
  if (trimmed === (was ?? '')) return undefined;
  return trimmed === '' ? null : trimmed;
};

const confirm = (): void => {
  const changedModel = change(model.value, props.model);
  const changedEffort = change(effort.value, props.effort);
  emit('confirm', {
    ...(changedModel === undefined ? {} : { model: changedModel }),
    ...(changedEffort === undefined ? {} : { effort: changedEffort }),
  });
};
const cancel = (): void => {
  emit('cancel');
};
useEscape(cancel);
</script>

<template>
  <form class="spec" @submit.prevent="confirm">
    <label class="field">
      <span>Model</span>
      <input
        ref="input"
        v-model="model"
        type="text"
        list="spec-model-hints"
        autocomplete="off"
        placeholder="box default"
      />
    </label>
    <datalist id="spec-model-hints">
      <option v-for="m in specHints.model" :key="m" :value="m" />
    </datalist>
    <label class="field">
      <span>Effort</span>
      <input
        v-model="effort"
        type="text"
        list="spec-effort-hints"
        autocomplete="off"
        enterkeyhint="done"
        placeholder="box default"
      />
    </label>
    <datalist id="spec-effort-hints">
      <option v-for="e in specHints.effort" :key="e" :value="e" />
    </datalist>
    <p class="hint">Closes the agent; your next message brings it back with these.</p>
    <div class="actions">
      <button type="button" class="secondary" @click="cancel">Cancel</button>
      <button type="submit" :disabled="busy">Restart</button>
    </div>
  </form>
</template>

<style scoped>
.spec {
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

.hint {
  color: var(--muted);
  margin: 0;
  font-size: 0.85rem;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
