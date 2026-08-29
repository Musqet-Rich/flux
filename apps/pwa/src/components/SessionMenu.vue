<script setup lang="ts">
import { computed, ref } from 'vue';

import type { Store } from '../store/create-store.ts';
import type { DeleteOptions } from '../store/session-actions.ts';
import DeleteConfirm from './DeleteConfirm.vue';
import RenameForm from './RenameForm.vue';

// The session's own menu, in its toolbar: rename, clear the agent's context, archive, or
// delete. No menu library: a button with `aria-haspopup="menu"` and a `role="menu"` list it
// shows. Archiving and deleting leave the session, so the parent is told to navigate away.

const props = defineProps<{ store: Store; session: string }>();
const emit = defineEmits<{ closed: [] }>();

const open = ref(false);
const confirming = ref(false);
const renaming = ref(false);
const dirty = ref<string | null>(null);
const busy = ref(false);

const title = computed(
  () => props.store.state.sessions.find((s) => s.session === props.session)?.title ?? '',
);

const toggle = (): void => {
  open.value = !open.value;
};

const run = async (action: () => Promise<boolean>, leave: boolean): Promise<void> => {
  open.value = false;
  busy.value = true;
  const ok = await action();
  busy.value = false;
  if (ok && leave) emit('closed');
};

const startRename = (): void => {
  open.value = false;
  confirming.value = false;
  renaming.value = true;
};
const cancelRename = (): void => {
  renaming.value = false;
};
const rename = async (next: string): Promise<void> => {
  busy.value = true;
  const ok = await props.store.renameSession(props.session, next);
  busy.value = false;
  if (ok) renaming.value = false;
};
const clear = (): void => {
  void run(() => props.store.clearSession(props.session), false);
};
const archive = (): void => {
  void run(() => props.store.archiveSession(props.session), true);
};
const startDelete = (): void => {
  open.value = false;
  renaming.value = false;
  dirty.value = null;
  confirming.value = true;
};
const cancel = (): void => {
  confirming.value = false;
  dirty.value = null;
};
const remove = async (options: DeleteOptions): Promise<void> => {
  busy.value = true;
  const outcome = await props.store.deleteSession(props.session, options);
  busy.value = false;
  if (outcome.ok) {
    confirming.value = false;
    emit('closed');
  } else if (outcome.dirty === null) {
    cancel();
  } else {
    dirty.value = outcome.dirty;
  }
};
</script>

<template>
  <div class="menu-root">
    <button
      type="button"
      class="secondary trigger"
      aria-haspopup="menu"
      :aria-expanded="open"
      aria-label="Session menu"
      :disabled="busy"
      @click="toggle"
    >
      ⋯
    </button>
    <div v-if="open" class="menu" role="menu" aria-label="Session">
      <button type="button" role="menuitem" @click="startRename">Rename…</button>
      <button type="button" role="menuitem" @click="clear">Clear context</button>
      <button type="button" role="menuitem" @click="archive">Archive</button>
      <button type="button" role="menuitem" class="danger" @click="startDelete">Delete…</button>
    </div>
    <div v-if="renaming" class="sheet">
      <RenameForm :title="title" :busy="busy" @confirm="rename" @cancel="cancelRename" />
    </div>
    <div v-if="confirming" class="sheet">
      <DeleteConfirm :dirty="dirty" :busy="busy" @confirm="remove" @cancel="cancel" />
    </div>
  </div>
</template>

<style scoped>
.menu-root {
  position: relative;
  flex: none;
}

.trigger {
  font-size: 1.1rem;
  line-height: 1;
  padding: 0.35rem 0.6rem;
}

.menu {
  position: absolute;
  right: 0;
  top: calc(100% + 0.25rem);
  z-index: 2;
  min-width: 10rem;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 4px 16px rgb(0 0 0 / 40%);
  overflow: hidden;
}

.menu button {
  background: transparent;
  color: var(--fg);
  border-radius: 0;
  text-align: left;
  padding: 0.6rem 0.9rem;
}

.menu button:hover {
  background: var(--panel-2);
}

.menu .danger {
  color: var(--danger);
}

.sheet {
  position: absolute;
  right: 0;
  top: calc(100% + 0.25rem);
  z-index: 2;
  width: min(20rem, 90vw);
}
</style>
