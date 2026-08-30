<script setup lang="ts">
import type { DirEntry } from '@flux/protocol';
import { computed, onMounted, ref, watch } from 'vue';

import type { Store } from '../store/create-store.ts';

// Walks the session's worktree so the operator can open any file, not only the changed ones
// (`fs.list`). Dirs come before files, each alphabetical; tapping a dir descends, tapping a file
// opens it in the editor. The current directory lives in the URL (`path`), so back-navigation and
// reload are stateless: the parent re-lists whenever `path` changes.

const props = defineProps<{ store: Store; session: string; path: string }>();
const emit = defineEmits<{ enter: [path: string]; open: [path: string]; back: [] }>();

const entries = ref<DirEntry[] | null>(null);
const loading = ref(false);
const failure = ref<string | null>(null);

const join = (dir: string, name: string): string => (dir === '' ? name : `${dir}/${name}`);

const sorted = computed((): DirEntry[] =>
  (entries.value ?? []).toSorted((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1,
  ),
);
const crumbs = computed(() =>
  props.path
    .split('/')
    .filter((seg) => seg !== '')
    .map((name, i, all) => ({ name, path: all.slice(0, i + 1).join('/') })),
);

const load = async (): Promise<void> => {
  loading.value = true;
  failure.value = null;
  try {
    const result = await props.store.call('fs.list', { session: props.session, path: props.path });
    entries.value = result.entries;
  } catch (error) {
    entries.value = null;
    failure.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
};

const tap = (entry: DirEntry): void => {
  const full = join(props.path, entry.name);
  if (entry.kind === 'dir') emit('enter', full);
  else emit('open', full);
};
const up = (): void => {
  if (props.path === '') return emit('back');
  const cut = props.path.lastIndexOf('/');
  emit('enter', cut === -1 ? '' : props.path.slice(0, cut));
};

onMounted(() => {
  void load();
});
watch(
  () => props.path,
  () => {
    void load();
  },
);
</script>

<template>
  <section class="files">
    <div class="toolbar">
      <button type="button" class="secondary" @click="up">
        ‹ {{ path === '' ? 'Session' : 'Up' }}
      </button>
      <nav class="crumbs">
        <button type="button" class="crumb" @click="emit('enter', '')">/</button>
        <template v-for="c in crumbs" :key="c.path">
          <span class="sep">/</span>
          <button type="button" class="crumb" @click="emit('enter', c.path)">{{ c.name }}</button>
        </template>
      </nav>
      <button type="button" class="secondary" :disabled="loading" @click="load">Refresh</button>
    </div>
    <p v-if="loading" class="notice">Loading…</p>
    <p v-else-if="failure !== null" class="notice">{{ failure }}</p>
    <p v-else-if="sorted.length === 0" class="empty">Empty directory.</p>
    <ul v-else class="list">
      <li v-for="e in sorted" :key="e.name" class="row">
        <button type="button" class="entry" :class="e.kind" @click="tap(e)">
          <span class="name">{{ e.name }}</span>
          <span v-if="e.kind === 'dir'" class="chev">›</span>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.files {
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

.crumbs {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.15rem;
  overflow: hidden;
}

.crumb {
  background: transparent;
  color: var(--muted);
  border-radius: 0;
  padding: 0.1rem 0.15rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
}

.sep {
  color: var(--muted);
  font-size: 0.85rem;
}

.notice,
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

.entry {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 0.6rem;
  align-items: center;
  background: transparent;
  color: var(--fg);
  border-radius: 0;
  padding: 0.6rem 0.75rem;
  text-align: left;
}

.name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
}

.entry.dir .name {
  color: var(--accent);
}

.chev {
  flex: none;
  color: var(--muted);
}
</style>
