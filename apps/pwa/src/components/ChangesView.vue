<script setup lang="ts">
import type { FileStatus } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';
import { computed, onMounted, ref } from 'vue';

import type { Store } from '../store/create-store.ts';
import GitActions from './GitActions.vue';

// The worktree's changed files. The last `files.changed` event renders at once; `git.status`
// refreshes it, since that event only follows an agent write. A rename opens with its old
// path too, which is the one the base revision knows. Ticked files narrow a commit to them.

const props = defineProps<{ store: Store; session: string }>();
const emit = defineEmits<{ open: [path: string, from: string | null]; back: [] }>();

const fresh = ref<FileStatus[] | null>(null);
const loading = ref(false);
const selected = ref<string[]>([]);

const fromLog = computed((): FileStatus[] => {
  const events = props.store.state.logs[props.session]?.events ?? [];
  const last = events.findLast((e) => e.type === 'files.changed');
  return last !== undefined && fluxEvent.isKnown(last) && last.type === 'files.changed'
    ? last.payload.files
    : [];
});
const files = computed(() => fresh.value ?? fromLog.value);
const selectedFiles = computed(() => files.value.filter((f) => selected.value.includes(f.path)));

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

// A commit or push changed the worktree: the ticks no longer refer to anything.
const acted = (): void => {
  selected.value = [];
  void refresh();
};

const open = (file: FileStatus): void => {
  emit('open', file.path, file.status === 'R' ? (file.from ?? null) : null);
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
      <li v-for="f in files" :key="f.path" class="row">
        <input
          v-model="selected"
          type="checkbox"
          class="pick"
          :value="f.path"
          :aria-label="`Tick ${f.path} for commit`"
        />
        <button type="button" class="file" :disabled="f.status === 'D'" @click="open(f)">
          <span class="status" :class="f.status">{{ f.status }}</span>
          <span class="path">{{ f.path }}</span>
          <span v-if="f.from !== undefined" class="from">← {{ f.from }}</span>
        </button>
      </li>
    </ul>
    <GitActions :store="store" :session="session" :selected="selectedFiles" @done="acted" />
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
  flex: 1;
  color: var(--muted);
  text-align: center;
  margin: 2rem 0;
}

.list {
  flex: 1;
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
}

.row {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--border);
}

.pick {
  flex: none;
  width: auto;
  margin: 0 0 0 0.75rem;
}

.file {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: center;
  background: transparent;
  color: var(--fg);
  border-radius: 0;
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

.status.R {
  color: var(--accent);
}

.status.D {
  color: var(--danger);
}

.path,
.from {
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
}

.from {
  color: var(--muted);
}
</style>
