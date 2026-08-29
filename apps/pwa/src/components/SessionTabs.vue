<script setup lang="ts">
import type { SessionSummary } from '@flux/protocol';

// One tab per session, newest activity first, plus the way to a new one.

defineProps<{ sessions: SessionSummary[]; active: string | null }>();
defineEmits<{ select: [session: string]; create: [] }>();

const sorted = (sessions: SessionSummary[]): SessionSummary[] =>
  sessions.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
</script>

<template>
  <nav class="tabs" aria-label="Sessions">
    <button
      v-for="s in sorted(sessions)"
      :key="s.session"
      type="button"
      class="tab"
      :class="{ active: s.session === active }"
      :title="`${s.repo} · ${s.branch}`"
      @click="$emit('select', s.session)"
    >
      <span class="dot" :class="s.state" />
      <span class="title">{{ s.title }}</span>
    </button>
    <button type="button" class="tab add" aria-label="New session" @click="$emit('create')">
      +
    </button>
  </nav>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 0.25rem;
  overflow-x: auto;
  padding: 0.4rem 0.5rem;
  scrollbar-width: none;
}

.tab {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: transparent;
  color: var(--muted);
  border: 1px solid transparent;
  border-radius: var(--radius);
  padding: 0.4rem 0.7rem;
  max-width: 12rem;
}

.tab.active {
  background: var(--panel-2);
  color: var(--fg);
  border-color: var(--border);
}

.title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.add {
  font-size: 1.2rem;
  line-height: 1;
}

.dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--muted);
}

.dot.running {
  background: var(--accent);
}

.dot.waiting_user {
  background: var(--warn);
}

.dot.idle {
  background: var(--ok);
}
</style>
