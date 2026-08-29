<script setup lang="ts">
import type { Route } from '../router/create-router.ts';
import type { Store } from '../store/create-store.ts';
import ChangesView from './ChangesView.vue';
import DiffView from './DiffView.vue';
import EditView from './EditView.vue';
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
</script>

<template>
  <SessionView
    v-if="route.name === 'session'"
    :store="store"
    :session="route.session"
    @changes="openChanges"
  />
  <ChangesView
    v-else-if="route.name === 'changes'"
    :store="store"
    :session="route.session"
    @open="openDiff"
    @edit="openEdit"
    @back="openSession"
  />
  <EditView
    v-else-if="route.name === 'edit'"
    :store="store"
    :session="route.session"
    :path="route.path"
    @back="openChanges"
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
