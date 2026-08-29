<script setup lang="ts">
import type { PendingAttachment } from '../store/store-state.ts';
import { formatBytes } from './format-bytes.ts';

// The files on the composer, one chip each (ADR 0020): a thumbnail for an image, an icon and
// the name otherwise, the size, a progress bar while the upload runs, the error and a Retry
// once it failed, and × to take the file off the message.

defineProps<{ attachments: PendingAttachment[] }>();
defineEmits<{ remove: [key: string]; retry: [key: string] }>();
</script>

<template>
  <ul v-if="attachments.length > 0" class="chips" aria-label="Attachments">
    <li
      v-for="a in attachments"
      :key="a.key"
      class="chip"
      :class="a.status"
      :title="a.error ?? a.name"
    >
      <img v-if="a.preview !== null" :src="a.preview" :alt="a.name" class="thumb" />
      <span v-else class="icon" aria-hidden="true">📄</span>
      <span class="meta">
        <span class="name">{{ a.name }}</span>
        <span class="size">{{ formatBytes(a.size) }}</span>
        <progress
          v-if="a.status === 'uploading'"
          class="progress"
          :value="a.progress"
          max="1"
          :aria-label="`Uploading ${a.name}`"
        />
        <span v-else-if="a.status === 'failed'" class="error">{{ a.error }}</span>
      </span>
      <button
        v-if="a.status === 'failed'"
        type="button"
        class="secondary retry"
        @click="$emit('retry', a.key)"
      >
        Retry
      </button>
      <button
        type="button"
        class="secondary remove"
        :aria-label="`Remove ${a.name}`"
        @click="$emit('remove', a.key)"
      >
        ×
      </button>
    </li>
  </ul>
</template>

<style scoped>
.chips {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.chip {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  max-width: 100%;
  padding: 0.25rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--panel-2);
  font-size: 0.8rem;
}

.chip.failed {
  border-color: var(--danger);
}

.thumb {
  width: 2.5rem;
  height: 2.5rem;
  object-fit: cover;
  border-radius: 4px;
}

.icon {
  font-size: 1.4rem;
}

.meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-width: 12rem;
}

.name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.size,
.error {
  color: var(--muted);
  font-size: 0.75rem;
}

.error {
  color: var(--danger);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.progress {
  width: 100%;
  height: 4px;
  accent-color: var(--accent);
}

.chip button {
  padding: 0.1rem 0.5rem;
  line-height: 1;
}
</style>
