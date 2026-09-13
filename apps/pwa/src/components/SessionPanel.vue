<script setup lang="ts">
import { computed } from 'vue';

import type { Route } from '../router/create-router.ts';
import type { Store } from '../store/create-store.ts';
import ChangesView from './ChangesView.vue';
import DiffView from './DiffView.vue';
import EditView from './EditView.vue';
import FilesView from './FilesView.vue';
import Icon from './Icon.vue';

// The screens of a session other than the chat: changes, the file browser, a diff, the editor,
// one at a time by the route. On a phone this is the whole screen and each has its Back; on a
// wide screen (ADR 0033, `paned`) it sits in a pane beside the chat under a strip of two
// tabs, Changes and Files, and a close, and the Back to the chat inside a view is hidden
// since the chat is right there. The tabs are navigation, not an ARIA tablist: each is a route,
// the lit one `aria-current`. A diff belongs to Changes and the editor to wherever it was
// opened from, so the parent is the lit one. Navigation goes back up as `go`; the close is its
// own event so the parent can put the focus somewhere once the button is gone.

type PanelRoute = Extract<Route, { name: 'changes' | 'files' | 'diff' | 'edit' }>;

const props = defineProps<{ store: Store; route: PanelRoute; paned: boolean }>();
const emit = defineEmits<{ go: [to: Route]; close: [] }>();

const go = (to: Route): void => {
  emit('go', to);
};
const openSession = (): void => {
  go({ name: 'session', session: props.route.session });
};
const openChanges = (): void => {
  go({ name: 'changes', session: props.route.session });
};
const openDiff = (path: string, from: string | null): void => {
  const { session } = props.route;
  go(from === null ? { name: 'diff', session, path } : { name: 'diff', session, path, from });
};
const openEdit = (path: string): void => {
  go({ name: 'edit', session: props.route.session, path });
};
const openFiles = (): void => {
  go({ name: 'files', session: props.route.session, path: '' });
};
const enterDir = (path: string): void => {
  go({ name: 'files', session: props.route.session, path });
};
// A file opened from the browser carries its containing dir, so the editor's back returns there.
const editFromFiles = (path: string): void => {
  const { session } = props.route;
  go({ name: 'edit', session, path, dir: props.route.name === 'files' ? props.route.path : '' });
};
const backFromEdit = (): void => {
  const r = props.route;
  if (r.name === 'edit' && r.dir !== undefined)
    go({ name: 'files', session: r.session, path: r.dir });
  else openChanges();
};
const tab = computed((): 'changes' | 'files' => {
  const r = props.route;
  if (r.name === 'files' || (r.name === 'edit' && r.dir !== undefined)) return 'files';
  return 'changes';
});
</script>

<template>
  <section class="panel" :class="{ paned }">
    <nav v-if="paned" class="tabs" aria-label="Changes and files">
      <button
        type="button"
        class="tab"
        :aria-current="tab === 'changes' ? 'page' : undefined"
        @click="openChanges"
      >
        Changes
      </button>
      <button
        type="button"
        class="tab"
        :aria-current="tab === 'files' ? 'page' : undefined"
        @click="openFiles"
      >
        Files
      </button>
      <button
        type="button"
        class="secondary icon-only close"
        aria-label="Close pane"
        title="Close pane"
        @click="emit('close')"
      >
        <Icon name="close" />
      </button>
    </nav>
    <ChangesView
      v-if="route.name === 'changes'"
      :store="store"
      :session="route.session"
      :paned="paned"
      @open="openDiff"
      @edit="openEdit"
      @back="openSession"
    />
    <FilesView
      v-else-if="route.name === 'files'"
      :store="store"
      :session="route.session"
      :path="route.path"
      :paned="paned"
      @enter="enterDir"
      @open="editFromFiles"
      @back="openSession"
    />
    <EditView
      v-else-if="route.name === 'edit'"
      :store="store"
      :session="route.session"
      :path="route.path"
      :dir="route.dir ?? null"
      @back="backFromEdit"
    />
    <DiffView
      v-else
      :store="store"
      :session="route.session"
      :path="route.path"
      :from="route.from ?? null"
      @edit="openEdit(route.path)"
      @back="openChanges"
    />
  </section>
</template>

<style scoped>
.panel {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.tabs {
  flex: none;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.3rem 0.5rem;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}

/* A tab is text with a line under the lit one, like the session tabs above. */
.tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  padding: 0.3rem 0.6rem;
  color: var(--muted);
  font: inherit;
  cursor: pointer;
}

.tab[aria-current='page'] {
  color: var(--fg);
  border-bottom-color: var(--accent);
}

.close {
  margin-left: auto;
}
</style>
