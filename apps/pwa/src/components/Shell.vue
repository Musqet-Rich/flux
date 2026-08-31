<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue';

import type { Route, Router } from '../router/create-router.ts';
import type { Store } from '../store/create-store.ts';
import ArchivedSessions from './ArchivedSessions.vue';
import HelpModal from './HelpModal.vue';
import NewSessionView from './NewSessionView.vue';
import SessionScreens from './SessionScreens.vue';
import SessionTabs from './SessionTabs.vue';
import SettingsView from './SettingsView.vue';
import StatusBar from './StatusBar.vue';

// The paired app: tabs on top, the routed screen in the middle, status at the bottom.

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
  <header class="top">
    <SessionTabs
      :sessions="state.sessions"
      :active="active"
      @select="openSession"
      @create="go({ name: 'new' })"
    />
    <button
      type="button"
      class="gear term"
      :class="{ active: route.name === 'runner' }"
      aria-label="Command runner"
      title="Run a command"
      @click="go({ name: 'runner' })"
    >
      &gt;_
    </button>
    <button
      type="button"
      class="gear help"
      aria-label="Ask about Flux"
      title="Ask about Flux"
      @click="helpOpen = true"
    >
      ⓘ
    </button>
    <button
      type="button"
      class="gear"
      :class="{ active: route.name === 'settings' }"
      aria-label="Settings"
      title="Settings"
      @click="go({ name: 'settings' })"
    >
      ⚙
    </button>
  </header>
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
.top {
  flex: none;
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  padding-top: env(safe-area-inset-top);
}

.top > :first-child {
  flex: 1;
  min-width: 0;
}

.gear {
  flex: none;
  background: transparent;
  color: var(--muted);
  font-size: 1.2rem;
  line-height: 1;
  padding: 0.4rem 0.6rem;
  margin-right: 0.4rem;
}

.gear.active {
  color: var(--fg);
}

.term {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.95rem;
  font-weight: 600;
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
