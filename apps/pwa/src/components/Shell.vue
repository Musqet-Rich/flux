<script setup lang="ts">
import { computed } from 'vue';

import type { Router } from '../router/create-router.ts';
import type { Route } from '../router/route.ts';
import type { Store } from '../store/create-store.ts';
import ChangesView from './ChangesView.vue';
import DiffView from './DiffView.vue';
import NewSessionView from './NewSessionView.vue';
import SessionTabs from './SessionTabs.vue';
import SessionView from './SessionView.vue';
import StatusBar from './StatusBar.vue';

// The paired app: tabs on top, the routed screen in the middle, status at the bottom.

const props = defineProps<{ store: Store; router: Router }>();

const state = props.store.state;
const route = computed(() => props.router.current.route);
const active = computed(() => ('session' in route.value ? route.value.session : null));

const go = (to: Route): void => {
  props.router.go(to);
};
const openSession = (session: string): void => {
  go({ name: 'session', session });
};
const openDiff = (session: string, path: string): void => {
  go({ name: 'diff', session, path });
};
</script>

<template>
  <header class="top">
    <SessionTabs
      :sessions="state.sessions"
      :active="active"
      @select="openSession"
      @create="go({ name: 'new' })"
    />
  </header>
  <main class="body">
    <section v-if="route.name === 'sessions'" class="empty">
      <p v-if="state.sessions.length === 0">No sessions yet.</p>
      <p v-else>Pick a session above.</p>
      <button type="button" @click="go({ name: 'new' })">New session</button>
    </section>
    <NewSessionView v-else-if="route.name === 'new'" :store="store" @created="openSession" />
    <SessionView
      v-else-if="route.name === 'session'"
      :store="store"
      :session="route.session"
      @changes="go({ name: 'changes', session: route.session })"
    />
    <ChangesView
      v-else-if="route.name === 'changes'"
      :store="store"
      :session="route.session"
      @open="openDiff(route.session, $event)"
      @back="openSession(route.session)"
    />
    <DiffView
      v-else
      :store="store"
      :session="route.session"
      :path="route.path"
      @back="go({ name: 'changes', session: route.session })"
    />
  </main>
  <StatusBar
    :status="state.status"
    :daemon="state.daemon"
    :error="state.error"
    :rate-windows="state.rateWindows"
  />
</template>

<style scoped>
.top {
  flex: none;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  padding-top: env(safe-area-inset-top);
}

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
