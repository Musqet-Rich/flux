<script setup lang="ts">
import type { FluxEvent } from '@flux/protocol';
import { computed } from 'vue';

import { fluxEvent } from '@flux/protocol';

import type { Store } from '../store/create-store.ts';
import { sessionPr } from '../store/session-pr.ts';
import SessionMenu from './SessionMenu.vue';

// The strip above the timeline: the branch, a small harness/model/effort chip (ADR 0023 § 3, the
// configured values from `SessionSummary`, unset segments omitted), a link to the session's PR
// once the log has a `pr.published`, Stop while the agent runs, Changes (with the latest
// changed-file count), and the session menu.

const props = defineProps<{
  store: Store;
  session: string;
  events: readonly FluxEvent[];
  branch: string;
  busy: boolean;
}>();
defineEmits<{ changes: []; files: []; interrupt: []; closed: [] }>();

const harnessLabel = (kind: string): string =>
  kind === 'claude' ? 'Claude Code' : kind === 'pi' ? 'Pi' : kind;
// The configured harness, model and effort as one chip; segments the box did not set are dropped.
const chip = computed((): string => {
  const summary = props.store.state.sessions.find((s) => s.session === props.session);
  if (summary === undefined) return '';
  return [harnessLabel(summary.harness), summary.model, summary.effort]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' · ');
});

const pr = computed(() => sessionPr(props.events));
const prLabel = computed(() =>
  pr.value?.identifier === '' ? 'PR' : `PR #${pr.value?.identifier}`,
);
// The count from the latest `files.changed` event, on the button so those events need not spam
// the timeline. `ChangesView` reads the same last event when its fresher `git.status` has not run.
const changedCount = computed(() => {
  const last = props.events.findLast((e) => e.type === 'files.changed');
  return last !== undefined && fluxEvent.isKnown(last) && last.type === 'files.changed'
    ? last.payload.files.length
    : 0;
});
</script>

<template>
  <div class="toolbar">
    <span class="branch">{{ branch }}</span>
    <span v-if="chip !== ''" class="spec-chip">{{ chip }}</span>
    <a v-if="pr !== null" class="pr" :href="pr.url" target="_blank" rel="noopener noreferrer">{{
      prLabel
    }}</a>
    <button v-if="busy" type="button" class="secondary" @click="$emit('interrupt')">Stop</button>
    <button type="button" class="secondary" @click="$emit('files')">Files</button>
    <button type="button" class="secondary" @click="$emit('changes')">
      Changes ({{ changedCount }})
    </button>
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

.spec-chip {
  flex: none;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.1rem 0.4rem;
  font-size: 0.75rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 12rem;
}

.pr {
  flex: none;
  color: var(--accent);
  font-size: 0.85rem;
  text-decoration: none;
}
</style>
