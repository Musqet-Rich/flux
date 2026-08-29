<script setup lang="ts">
import { onMounted } from 'vue';

import type { Store } from '../store/create-store.ts';
import AgentConfigEditor from './AgentConfigEditor.vue';
import DevicesSection from './DevicesSection.vue';
import FluxSettingsForm from './FluxSettingsForm.vue';

// The settings screen (prd.md P2): paired devices, the box's runtime settings, and the agent's
// global config. Each section talks to the store on its own; this only fetches on open.

const props = defineProps<{ store: Store }>();
defineEmits<{ back: [] }>();

onMounted(() => {
  void props.store.refreshDevices();
  void props.store.refreshSettings();
});
</script>

<template>
  <section class="settings">
    <div class="toolbar">
      <button type="button" class="secondary" @click="$emit('back')">‹ Sessions</button>
      <h1>Settings</h1>
    </div>
    <div class="sections">
      <DevicesSection :store="store" />
      <FluxSettingsForm :store="store" />
      <AgentConfigEditor :store="store" />
    </div>
  </section>
</template>

<style scoped>
.settings {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.toolbar {
  flex: none;
  display: flex;
  gap: 0.75rem;
  align-items: center;
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--border);
}

h1 {
  font-size: 1.1rem;
  margin: 0;
}

.sections {
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-width: 40rem;
  width: 100%;
  box-sizing: border-box;
  margin: 0 auto;
}
</style>
