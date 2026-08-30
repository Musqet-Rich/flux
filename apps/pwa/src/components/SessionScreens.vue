<script setup lang="ts">
import type { Route } from '../router/create-router.ts';
import type { Store } from '../store/create-store.ts';
import ChangesView from './ChangesView.vue';
import DiffView from './DiffView.vue';
import EditView from './EditView.vue';
import FilesView from './FilesView.vue';
import SessionView from './SessionView.vue';

// The screens of one session: chat, changes, a diff, an editor. Split from Shell so each file
// stays inside the import budget; navigation goes back up as `go`.

type SessionRoute = Extract<Route, { session: string }>;

const props = defineProps<{ store: Store; route: SessionRoute }>();
const emit = defineEmits<{ go: [to: Route] }>();

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
</script>

<template>
  <SessionView
    v-if="route.name === 'session'"
    :store="store"
    :session="route.session"
    @changes="openChanges"
    @files="openFiles"
    @closed="go({ name: 'sessions' })"
  />
  <ChangesView
    v-else-if="route.name === 'changes'"
    :store="store"
    :session="route.session"
    @open="openDiff"
    @edit="openEdit"
    @back="openSession"
  />
  <FilesView
    v-else-if="route.name === 'files'"
    :store="store"
    :session="route.session"
    :path="route.path"
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
</template>
