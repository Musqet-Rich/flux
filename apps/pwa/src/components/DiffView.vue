<script setup lang="ts">
import type { LineRange } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';
import { computed, onMounted, onUnmounted, ref } from 'vue';

import { ClientError } from '../client/client-error.ts';
import type { DiffEditor } from '../editor/create-diff-editor.ts';
import { createDiffEditor } from '../editor/create-diff-editor.ts';
import type { Store } from '../store/create-store.ts';
import { pendingComments } from '../store/pending-comments.ts';
import CommentTray from './CommentTray.vue';

// One file as a unified diff from the branch base to the worktree, with line comments. The
// original comes from `git.show` at the base recorded in `session.created`, under the file's
// old name for a rename; a file the base does not have is an addition and diffs against nothing.

const props = defineProps<{ store: Store; session: string; path: string; from: string | null }>();
defineEmits<{ back: [] }>();

const host = ref<HTMLElement | null>(null);
const loading = ref(true);
const failure = ref<string | null>(null);
const selection = ref<LineRange | null>(null);
const text = ref('');
const posting = ref(false);
let editor: DiffEditor | null = null;

const pending = computed(() =>
  pendingComments(props.store.state.logs[props.session]?.events ?? []).filter(
    (c) => c.ref.path === props.path,
  ),
);
const lines = computed(() => {
  const r = selection.value;
  if (r === null) return null;
  return r.startLine === r.endLine ? `line ${r.startLine}` : `lines ${r.startLine}–${r.endLine}`;
});

const baseRev = (): string | null => {
  const events = props.store.state.logs[props.session]?.events ?? [];
  const created = events.find((e) => e.type === 'session.created');
  return created !== undefined && fluxEvent.isKnown(created) && created.type === 'session.created'
    ? created.payload.base
    : null;
};

// Only "the base has no such file" is an addition; any other failure is shown as one.
const missing = (error: unknown): boolean =>
  error instanceof ClientError && (error.code === 'git_error' || error.code === 'not_found');

const original = async (rev: string): Promise<string> => {
  const path = props.from ?? props.path;
  try {
    const shown = await props.store.call('git.show', { session: props.session, path, rev });
    return shown.binary ? '' : shown.content;
  } catch (error) {
    if (missing(error)) return '';
    throw error;
  }
};

const mount = (parent: HTMLElement, before: string, current: string): void => {
  editor = createDiffEditor({
    parent,
    original: before,
    current,
    onSelection: (range) => {
      selection.value = range;
    },
  });
};

const load = async (): Promise<void> => {
  await props.store.open(props.session);
  const rev = baseRev();
  const parent = host.value;
  if (rev === null || parent === null) {
    failure.value = 'Session has no base commit yet.';
    loading.value = false;
    return;
  }
  try {
    const [before, current] = await Promise.all([
      original(rev),
      props.store.call('fs.read', { session: props.session, path: props.path }),
    ]);
    if (current.binary) failure.value = 'Binary file.';
    else mount(parent, before, current.content);
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
};

const comment = async (): Promise<void> => {
  const range = selection.value;
  const body = text.value.trim();
  if (range === null || body === '' || posting.value) return;
  posting.value = true;
  const codeRef = { path: props.path, rev: 'worktree', range };
  const ok = await props.store.addComment(props.session, codeRef, body);
  posting.value = false;
  if (!ok) return;
  text.value = '';
  editor?.clearSelection();
};

const remove = (commentId: string): void => {
  void props.store.removeComment(props.session, commentId);
};

onMounted(() => {
  void load();
});
onUnmounted(() => {
  editor?.destroy();
});
</script>

<template>
  <section class="diff">
    <div class="toolbar">
      <button type="button" class="secondary" @click="$emit('back')">‹ Changes</button>
      <code class="path">{{ path }}</code>
    </div>
    <p v-if="loading" class="notice">Loading…</p>
    <p v-else-if="failure !== null" class="notice">{{ failure }}</p>
    <div ref="host" class="editor" :class="{ hidden: loading || failure !== null }" />
    <div class="tray">
      <CommentTray :comments="pending" @remove="remove" />
      <form v-if="lines !== null" class="compose" @submit.prevent="comment">
        <label for="diff-comment">Comment on {{ lines }}</label>
        <textarea id="diff-comment" v-model="text" rows="2" placeholder="What should change?" />
        <button type="submit" :disabled="posting || text.trim() === ''">Add comment</button>
      </form>
      <p v-else class="hint">Tap a line number or select lines to comment.</p>
    </div>
  </section>
</template>

<style scoped>
.diff {
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

.path {
  overflow-wrap: anywhere;
  color: var(--muted);
}

.notice {
  color: var(--muted);
  text-align: center;
  margin: 2rem 0;
}

.editor {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.editor.hidden {
  display: none;
}

.tray {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--border);
  background: var(--panel);
}

.compose {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.hint {
  margin: 0;
  color: var(--muted);
  font-size: 0.8rem;
}
</style>
