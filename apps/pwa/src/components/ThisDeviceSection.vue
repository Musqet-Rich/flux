<script setup lang="ts">
import type { Store } from '../store/create-store.ts';
import SendKeyPicker from './SendKeyPicker.vue';
import SoundPicker from './SoundPicker.vue';
import SwitchKeyPicker from './SwitchKeyPicker.vue';

// The choices that belong to this device rather than the box: its notification sound, which
// Enter sends a message and which chord switches session tabs. Each applies as it is changed,
// so there is no Save here.

defineProps<{ store: Store }>();
</script>

<template>
  <section class="this-device">
    <h2>This device</h2>
    <SoundPicker :store="store" />
    <SendKeyPicker :store="store" />
    <SwitchKeyPicker :store="store" />
  </section>
</template>

<style scoped>
h2 {
  font-size: 1rem;
  margin: 0 0 0.5rem;
}

.this-device {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
</style>
