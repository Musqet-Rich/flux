<script setup lang="ts">
import type { FileStatus } from '@flux/protocol';
import { computed, onMounted, ref } from 'vue';

import type { Store } from '../store/create-store.ts';

// The worktree's changed files. The last `files.changed` event renders at once; `git.status`
// refreshes it, since that event only follows an agent write.

const props = defineProps<{ store: Store; session: string }>();
defineEmits<{ open: [path: string]; back: [] }>();

const fresh = ref<FileStatus[] | null>(null);
const loading = ref(false);

const fromLog = computed((): FileStatus[] => {
  const events = props.store.state.logs[props.session]?.events ?? [];
  const last = events.findLast((e) => e.type === 'files.changed');
  return last?.type === 'files.changed' ? last.payload.files : [];
});
const files = computed(() => fresh.value ?? fromLog.value);

const refresh = async (): Promise<void> => {
  loading.value = true;
  try {
    const result = await props.store.call('git.status', { session: props.session });
    fresh.value = result.files;
  } catch {
    // The log's copy stays on screen; the status bar shows connection trouble.
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  void props.store.open(props.session);
  void refresh();
});
</script>

<template>
  <section class="changes">
    <div class="toolbar">
      <button type="button" class="secondary" @click="$emit('back')">‹ Session</button>
      <span class="count">{{ files.length }} changed</span>
      <button type="button" class="secondary" :disabled="loading" @click="refresh">Refresh</button>
    </div>
    <p v-if="files.length === 0" class="empty">No changes in the worktree.</p>
    <ul v-else class="list">
      <li v-for="f in files" :key="f.path">
        <button
          type="button"
          class="file"
          :disabled="f.status === 'D'"
          @click="$emit('open', f.path)"
        >
          <span class="status" :class="f.status">{{ f.status }}</span>
          <span class="path">{{ f.path }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.changes {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.toolbar {
  flex: none;
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--border);
}

.count {
  flex: 1;
  color: var(--muted);
}

.empty {
  color: var(--muted);
  text-align: center;
  margin: 2rem 0;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
}

.file {
  width: 100%;
  display: flex;
  gap: 0.6rem;
  align-items: center;
  background: transparent;
  color: var(--fg);
  border-radius: 0;
  border-bottom: 1px solid var(--border);
  padding: 0.6rem 0.75rem;
  text-align: left;
}

.status {
  flex: none;
  width: 1.2rem;
  text-align: center;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--muted);
}

.status.A {
  color: var(--ok);
}

.status.M {
  color: var(--warn);
}

.status.D {
  color: var(--danger);
}

.path {
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
}
</style>
