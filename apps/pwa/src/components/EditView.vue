<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';

import type { CodeEditor } from '../editor/create-code-editor.ts';
import type { Store } from '../store/create-store.ts';

// One worktree file in an editor (PRD P2). Save sends the hash the file was read with, so an
// agent's write in the meantime comes back as a conflict instead of being overwritten; the
// operator then reloads or overwrites. A file over 1 MiB arrives truncated and is read-only.
// Unsaved text lives in `store.state.drafts`, so leaving by any route keeps it.
//
// CodeMirror keeps lines, not line endings: a CRLF file comes back joined with LF, so the
// ending seen at load is put back on save and the file's bytes only change where it was edited.
// A file with mixed endings becomes uniform on save (CRLF if any line had it, else LF).

// `dir` is the browser directory this file was opened from (null when reached from the changes
// list); it only labels the back button, which the parent routes to that directory or to changes.
const props = defineProps<{ store: Store; session: string; path: string; dir: string | null }>();
const emit = defineEmits<{ back: [] }>();

const host = ref<HTMLElement | null>(null);
const loading = ref(true);
const failure = ref<string | null>(null);
const readOnly = ref<string | null>(null);
const dirty = ref(false);
const saving = ref(false);
const conflict = ref(false);
const restored = ref(false);
const dropped = ref(false);
let hash: string | null = null;
let eol = '\n';
let saved = '';
// Exposed as a ref so tests can type into it; it is not rendered.
const editor = shallowRef<CodeEditor | null>(null);

const draftKey = computed(() => `${props.session}\0${props.path}`);
const canSave = computed(
  () => dirty.value && !saving.value && !conflict.value && readOnly.value === null,
);

const text = (): string => (editor.value?.doc() ?? '').replaceAll('\n', eol);

const changed = (): void => {
  const now = text();
  dirty.value = now !== saved;
  if (dirty.value && hash !== null) {
    props.store.state.drafts[draftKey.value] = { hash, text: now };
  } else {
    delete props.store.state.drafts[draftKey.value];
  }
};

const save = async (ifMatch: string | null): Promise<void> => {
  const current = editor.value;
  if (saving.value || current === null || hash === null || readOnly.value !== null) return;
  saving.value = true;
  const sent = text();
  const outcome = await props.store.saveFile(props.session, props.path, sent, ifMatch);
  saving.value = false;
  if (outcome.ok) {
    hash = outcome.hash;
    saved = sent;
    conflict.value = false;
    changed();
  } else if (outcome.conflict) {
    conflict.value = true;
  }
};

const mount = async (parent: HTMLElement, doc: string): Promise<void> => {
  // Loaded on demand: the other screens do not carry the editor's commands and keymap.
  const { createCodeEditor } = await import('../editor/create-code-editor.ts');
  editor.value = createCodeEditor({
    parent,
    doc,
    readOnly: readOnly.value !== null,
    onChange: changed,
    onSave: () => {
      if (canSave.value) void save(hash);
    },
  });
};

// A draft typed over this same version of the file comes back on the screen; one typed over
// an older version is dropped, and the operator is told rather than left to wonder.
const draftFor = (fileHash: string | null, content: string): string => {
  const draft = props.store.state.drafts[draftKey.value];
  if (draft === undefined) return content;
  restored.value = draft.hash === fileHash;
  dropped.value = !restored.value;
  return restored.value ? draft.text : content;
};

// Reads the file; on a reload the editor takes the fresh text and forgets the local edits.
const load = async (): Promise<void> => {
  const parent = host.value;
  if (parent === null) return;
  loading.value = true;
  try {
    const file = await props.store.call('fs.read', { session: props.session, path: props.path });
    if (file.binary) {
      failure.value = 'Binary or non-UTF-8 file.';
      return;
    }
    hash = file.hash ?? null;
    eol = file.content.includes('\r\n') ? '\r\n' : '\n';
    saved = file.content;
    if (file.truncated === true) readOnly.value = 'Over 1 MiB: showing the first part, read-only.';
    else if (hash === null) readOnly.value = 'This box cannot save files; update the daemon.';
    const doc = conflict.value ? file.content : draftFor(hash, file.content);
    if (editor.value === null) await mount(parent, doc);
    else editor.value.setDoc(doc);
    conflict.value = false;
    changed();
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
};

const discard = (): void => {
  editor.value?.setDoc(saved);
  changed();
};

const warnUnload = (event: BeforeUnloadEvent): void => {
  if (dirty.value) event.preventDefault();
};

onMounted(() => {
  void load();
  window.addEventListener('beforeunload', warnUnload);
});
onUnmounted(() => {
  window.removeEventListener('beforeunload', warnUnload);
  editor.value?.destroy();
});
</script>

<template>
  <section class="edit">
    <div class="toolbar">
      <button type="button" class="secondary" @click="emit('back')">
        ‹ {{ dir === null ? 'Changes' : 'Files' }}
      </button>
      <code class="path">{{ path }}</code>
      <span v-if="dirty" class="dirty" title="Unsaved changes">●</span>
      <button v-if="dirty" type="button" class="secondary discard" @click="discard">Discard</button>
      <button type="button" class="save" :disabled="!canSave" @click="save(hash)">
        {{ saving ? 'Saving…' : 'Save' }}
      </button>
    </div>
    <p v-if="loading" class="notice">Loading…</p>
    <p v-else-if="failure !== null" class="notice">{{ failure }}</p>
    <p v-else-if="readOnly !== null" class="banner">{{ readOnly }}</p>
    <p v-else-if="restored && dirty" class="banner">Unsaved edits restored.</p>
    <p v-else-if="dropped" class="banner">
      Older unsaved edits were dropped: the file changed on the box since they were typed.
    </p>
    <div v-if="conflict" class="banner conflict">
      <span>Changed on the box since you opened it.</span>
      <button type="button" class="secondary" @click="load">Reload</button>
      <button type="button" class="overwrite" @click="save(null)">Overwrite</button>
    </div>
    <div ref="host" class="editor" :class="{ hidden: loading || failure !== null }" />
  </section>
</template>

<style scoped>
.edit {
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
  flex: 1;
  overflow-wrap: anywhere;
  color: var(--muted);
}

.dirty {
  color: var(--warn);
}

.notice {
  color: var(--muted);
  text-align: center;
  margin: 2rem 0;
}

.banner {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin: 0;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  color: var(--muted);
  font-size: 0.85rem;
}

.banner.conflict {
  color: var(--warn);
}

.overwrite {
  background: var(--danger);
}

.editor {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.editor.hidden {
  display: none;
}
</style>
