<script setup lang="ts">
import type { FluxEvent } from '@flux/protocol';
import { computed } from 'vue';

import type { Store } from '../store/create-store.ts';
import { sessionPr } from '../store/session-pr.ts';
import SessionMenu from './SessionMenu.vue';

// The strip above the timeline: the branch, a link to the session's PR once the log has a
// `pr.published`, Stop while the agent runs, Changes, and the session menu.

const props = defineProps<{
  store: Store;
  session: string;
  events: readonly FluxEvent[];
  branch: string;
  busy: boolean;
}>();
defineEmits<{ changes: []; interrupt: []; closed: [] }>();

const pr = computed(() => sessionPr(props.events));
const prLabel = computed(() =>
  pr.value?.identifier === '' ? 'PR' : `PR #${pr.value?.identifier}`,
);
</script>

<template>
  <div class="toolbar">
    <span class="branch">{{ branch }}</span>
    <a v-if="pr !== null" class="pr" :href="pr.url" target="_blank" rel="noopener noreferrer">{{
      prLabel
    }}</a>
    <button v-if="busy" type="button" class="secondary" @click="$emit('interrupt')">Stop</button>
    <button type="button" class="secondary" @click="$emit('changes')">Changes</button>
    <SessionMenu :store="store" :session="session" @closed="$emit('closed')" />
  </div>
</template>

<style scoped>
.toolbar {
  flex: none;
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--border);
}

.branch {
  flex: 1;
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pr {
  flex: none;
  color: var(--accent);
  font-size: 0.85rem;
  text-decoration: none;
}
</style>
