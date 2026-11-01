<script setup lang="ts">
import { pairing } from '@flux/protocol';
import { computed, onMounted } from 'vue';

import Home from './components/Home.vue';
import Shell from './components/Shell.vue';
import { notificationOpens } from './push/notification-opens.ts';
import { browserHistory } from './router/browser-history.ts';
import { createRouter } from './router/create-router.ts';
import { appStore } from './store/app-store.ts';

// Root: boots the store (or pairs from a link), then shows the homepage or the app shell. A
// notification's daemon (ADR 0037) is read from the address before the router drops the query.

const store = appStore;
const wanted = notificationOpens.fromQuery(location.search);
const router = createRouter(browserHistory);
const paired = computed(() => store.state.phase === 'paired');
const error = computed(() => store.state.error?.message ?? null);

// A pairing link lands here with its payload in the fragment (protocol.md § 1); it is cleared
// before anything else reads the URL so it never survives a reload.
const pairFromFragment = async (fragment: string): Promise<void> => {
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  await store.pair(location.origin, fragment);
  router.replace({ name: 'sessions' });
};

// A tap on another daemon's notification while the app is open: that daemon opens (Shell goes
// to its sessions on the switch), then the session the notice was about.
const openFromNotification = async (daemon: string, session: string | null): Promise<void> => {
  if (!(await store.switchDaemon(daemon)) || session === null) return;
  router.go({ name: 'session', session });
};

onMounted(() => {
  const fragment = location.hash;
  if (pairing.parse(fragment) === null) void store.boot(wanted);
  else void pairFromFragment(fragment);
  notificationOpens.listen((open) => {
    void openFromNotification(open.daemon, open.session);
  });
});
</script>

<template>
  <div class="app">
    <Shell v-if="paired" :store="store" :router="router" />
    <Home v-else :phase="store.state.phase" :error="error" @pair="store.pair" />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  /* A page wider than the viewport lets a phone pan and zoom the whole app; every screen wraps
     or scrolls its own content, and this is the backstop should one leak. */
  overflow: hidden;
}
</style>
