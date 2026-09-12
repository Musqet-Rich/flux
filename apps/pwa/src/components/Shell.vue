<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue';

import type { Route, Router } from '../router/create-router.ts';
import type { Store } from '../store/create-store.ts';
import AppHeader from './AppHeader.vue';
import ArchivedSessions from './ArchivedSessions.vue';
import HelpModal from './HelpModal.vue';
import NewSessionView from './NewSessionView.vue';
import SessionScreens from './SessionScreens.vue';
import SettingsView from './SettingsView.vue';
import StatusBar from './StatusBar.vue';

// The paired app: the header (tabs and the global buttons) on top, the routed screen in the
// middle, status at the bottom.

// Loaded on demand: the runner is a rarely-opened screen, and this also keeps Shell within its
// dependency budget (a static import would make it one over).
const CommandRunner = defineAsyncComponent(() => import('./CommandRunner.vue'));

const props = defineProps<{ store: Store; router: Router }>();

const state = props.store.state;
const route = computed(() => props.router.current.route);
const active = computed(() => ('session' in route.value ? route.value.session : null));
const error = computed(() => state.error?.message ?? null);
const live = computed(() => state.sessions.filter((s) => s.archived !== true));
// The status bar's context-window reading is per-session, kept with the open session's log view
// (like `thinking`); off a session there is nothing to show.
const context = computed(() =>
  active.value === null ? null : (state.logs[active.value]?.context ?? null),
);

const helpOpen = ref(false);

const go = (to: Route): void => {
  props.router.go(to);
};
const openSession = (session: string): void => {
  go({ name: 'session', session });
};
const onHelpCreated = (session: { session: string }): void => {
  helpOpen.value = false;
  openSession(session.session);
};
const enablePush = (): void => {
  void props.store.enablePush();
};
</script>

<template>
  <AppHeader
    :sessions="state.sessions"
    :active="active"
    :screen="route.name"
    @select="openSession"
    @create="go({ name: 'new' })"
    @runner="go({ name: 'runner' })"
    @help="helpOpen = true"
    @settings="go({ name: 'settings' })"
  />
  <HelpModal v-if="helpOpen" :store="store" @created="onHelpCreated" @close="helpOpen = false" />
  <main class="body">
    <template v-if="route.name === 'sessions'">
      <section class="empty">
        <p v-if="live.length === 0">No sessions yet.</p>
        <p v-else>Pick a session above.</p>
        <button type="button" @click="go({ name: 'new' })">New session</button>
      </section>
      <ArchivedSessions :store="store" @reopened="openSession" />
    </template>
    <NewSessionView v-else-if="route.name === 'new'" :store="store" @created="openSession" />
    <SettingsView
      v-else-if="route.name === 'settings'"
      :store="store"
      @back="go({ name: 'sessions' })"
    />
    <CommandRunner
      v-else-if="route.name === 'runner'"
      :store="store"
      @back="go({ name: 'sessions' })"
    />
    <SessionScreens v-else :store="store" :route="route" @go="go" />
  </main>
  <StatusBar
    :status="state.status"
    :daemon="state.daemon"
    :error="error"
    :push="state.push"
    :rate-windows="state.rateWindows"
    :context="context"
    @enable-push="enablePush"
    @dismiss="store.dismissError"
  />
</template>

<style scoped>
.body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.empty {
  margin: auto;
  text-align: center;
  color: var(--muted);
}
</style>
