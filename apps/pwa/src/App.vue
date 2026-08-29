<script setup lang="ts">
import { pairing } from '@flux/protocol';
import { computed, onMounted } from 'vue';

import Pair from './components/Pair.vue';
import Shell from './components/Shell.vue';
import { browserHistory } from './router/browser-history.ts';
import { createRouter } from './router/create-router.ts';
import { appStore } from './store/app-store.ts';

// Root: boots the store (or pairs from a link), then shows the pair screen or the app shell.

const store = appStore;
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

onMounted(() => {
  const fragment = location.hash;
  if (pairing.parse(fragment) === null) void store.boot();
  else void pairFromFragment(fragment);
});
</script>

<template>
  <div class="app">
    <Shell v-if="paired" :store="store" :router="router" />
    <Pair v-else :phase="store.state.phase" :error="error" @pair="store.pair" />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}
</style>
