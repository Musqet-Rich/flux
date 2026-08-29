<script setup lang="ts">
import { pwaName } from './index.ts';

const title = pwaName();
</script>

<template>
  <main>
    <h1>{{ title }}</h1>
  </main>
</template>

<style scoped>
main {
  font-family: system-ui, sans-serif;
  padding: 1rem;
}
</style>
