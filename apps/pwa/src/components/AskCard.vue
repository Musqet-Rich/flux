<script setup lang="ts">
import type { EventPayloads } from '@flux/protocol';
import { ref } from 'vue';

// The agent's open question (flux_ask): tap an option or type an answer.

defineProps<{ ask: EventPayloads['ask'] }>();
const emit = defineEmits<{ answer: [text: string] }>();

const custom = ref('');

const submit = (): void => {
  const text = custom.value.trim();
  if (text === '') return;
  emit('answer', text);
  custom.value = '';
};
</script>

<template>
  <section class="ask">
    <p class="question">{{ ask.question }}</p>
    <div v-if="ask.options !== undefined" class="options">
      <button
        v-for="option in ask.options"
        :key="option"
        type="button"
        class="secondary"
        @click="$emit('answer', option)"
      >
        {{ option }}
      </button>
    </div>
    <form class="custom" @submit.prevent="submit">
      <input v-model="custom" type="text" placeholder="Or answer in your own words" />
      <button type="submit" :disabled="custom.trim() === ''">Answer</button>
    </form>
  </section>
</template>

<style scoped>
.ask {
  border: 1px solid var(--warn);
  border-radius: var(--radius);
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  background: var(--panel);
}

.question {
  margin: 0;
  white-space: pre-wrap;
}

.options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.custom {
  display: flex;
  gap: 0.5rem;
}
</style>
