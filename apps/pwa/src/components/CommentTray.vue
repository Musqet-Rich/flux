<script setup lang="ts">
import type { PendingComment } from '../store/pending-comments.ts';

// Comments waiting to go with the next message; each can still be withdrawn.

defineProps<{ comments: PendingComment[] }>();
defineEmits<{ remove: [commentId: string] }>();

const where = (c: PendingComment): string => {
  const { range } = c.ref;
  if (range === undefined) return c.ref.path;
  const lines =
    range.startLine === range.endLine
      ? `${range.startLine}`
      : `${range.startLine}–${range.endLine}`;
  return `${c.ref.path}:${lines}`;
};
</script>

<template>
  <ul v-if="comments.length > 0" class="tray" aria-label="Pending comments">
    <li v-for="c in comments" :key="c.commentId" class="comment">
      <div class="body">
        <code class="where">{{ where(c) }}</code>
        <span class="text">{{ c.text }}</span>
      </div>
      <button
        type="button"
        class="secondary remove"
        aria-label="Remove comment"
        @click="$emit('remove', c.commentId)"
      >
        ×
      </button>
    </li>
  </ul>
</template>

<style scoped>
.tray {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.comment {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.5rem 0.6rem;
}

.body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.where {
  color: var(--muted);
  overflow-wrap: anywhere;
}

.text {
  white-space: pre-wrap;
}

.remove {
  flex: none;
  padding: 0.2rem 0.6rem;
}
</style>
