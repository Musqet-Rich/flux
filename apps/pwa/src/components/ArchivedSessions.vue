<script setup lang="ts">
import type { SessionSummary } from '@flux/protocol';
import { computed, ref } from 'vue';

import type { Store } from '../store/create-store.ts';
import type { DeleteOptions } from '../store/session-actions.ts';
import DeleteConfirm from './DeleteConfirm.vue';

// The archived sessions, folded away at the bottom of the list screen. Each can be reopened
// (not when its worktree is gone from the box: there is nothing to come back to) or deleted.

const props = defineProps<{ store: Store }>();
const emit = defineEmits<{ reopened: [session: string] }>();

const archived = computed(() =>
  props.store.state.sessions
    .filter((s) => s.archived === true)
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
);
// The row whose delete confirm is open, and the box's dirty message for it.
const confirming = ref<string | null>(null);
const dirty = ref<string | null>(null);
const busy = ref(false);

const goneHint = 'The worktree is gone from the box; the session cannot be reopened.';

const reopen = async (session: string): Promise<void> => {
  busy.value = true;
  const ok = await props.store.unarchiveSession(session);
  busy.value = false;
  if (ok) emit('reopened', session);
};
const startDelete = (session: string): void => {
  confirming.value = session;
  dirty.value = null;
};
const cancel = (): void => {
  confirming.value = null;
  dirty.value = null;
};
const remove = async (options: DeleteOptions): Promise<void> => {
  const session = confirming.value;
  if (session === null) return;
  busy.value = true;
  const outcome = await props.store.deleteSession(session, options);
  busy.value = false;
  if (!outcome.ok && outcome.dirty !== null) dirty.value = outcome.dirty;
  else cancel();
};
</script>

<template>
  <details v-if="archived.length > 0" class="archived">
    <summary>Archived ({{ archived.length }})</summary>
    <ul class="rows">
      <li v-for="s in archived" :key="s.session" class="row" :class="{ gone: !s.worktreeExists }">
        <div class="who">
          <span class="title">{{ s.title }}</span>
          <span class="branch">{{ s.branch }}</span>
        </div>
        <button
          type="button"
          class="secondary"
          :disabled="busy || s.worktreeExists === false"
          :title="s.worktreeExists === false ? goneHint : undefined"
          @click="reopen(s.session)"
        >
          Reopen
        </button>
        <button type="button" class="secondary" :disabled="busy" @click="startDelete(s.session)">
          Delete
        </button>
        <DeleteConfirm
          v-if="confirming === s.session"
          class="confirm"
          :dirty="dirty"
          :busy="busy"
          @confirm="remove"
          @cancel="cancel"
        />
      </li>
    </ul>
  </details>
</template>

<style scoped>
.archived {
  flex: none;
  margin: 0 0.75rem 0.75rem;
  border-top: 1px solid var(--border);
  padding-top: 0.5rem;
}

summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 0.9rem;
}

.rows {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.who {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.branch {
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
}

.gone .title {
  color: var(--muted);
}

.confirm {
  flex-basis: 100%;
}
</style>
