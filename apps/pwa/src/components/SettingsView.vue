<script setup lang="ts">
import { onMounted } from 'vue';

import type { Store } from '../store/create-store.ts';
import AgentsEditor from './AgentsEditor.vue';
import AppearanceSection from './AppearanceSection.vue';
import HarnessConfigEditor from './HarnessConfigEditor.vue';
import DevicesSection from './DevicesSection.vue';
import FluxSettingsForm from './FluxSettingsForm.vue';
import Icon from './Icon.vue';
import SkillsEditor from './SkillsEditor.vue';
import ThisDeviceSection from './ThisDeviceSection.vue';

// The settings screen (prd.md P2): paired devices, the box's runtime settings, this device's
// own choices, how the app looks on it (ADR 0030), and the agent's global config. Each section
// talks to the store on its own; this only fetches on open.

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
      <button
        type="button"
        class="secondary icon-only"
        aria-label="Back to sessions"
        title="Back to sessions"
        @click="$emit('back')"
      >
        <Icon name="back" />
      </button>
      <h1>Settings</h1>
    </div>
    <div class="sections">
      <DevicesSection :store="store" />
      <ThisDeviceSection :store="store" />
      <AppearanceSection :appearance="store.appearance" />
      <FluxSettingsForm :store="store" />
      <AgentsEditor :store="store" />
      <SkillsEditor :store="store" />
      <HarnessConfigEditor :store="store" />
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

/* Wide screens: the devices list, this device's choices and the appearance stack beside the
   taller Flux form, the editors span below. On a phone the device's own sections come before
   the Flux form because they are the settings an operator comes back to. Each section is
   placed by its own root class (a child's root carries this scope), not by position, so
   adding one cannot shuffle the others. */
@media (min-width: 56rem) {
  .sections {
    max-width: 76rem;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-areas:
      'devices flux'
      'this-device flux'
      'appearance flux'
      'agents agents'
      'skills skills'
      'config config';
    align-items: start;
    gap: 1.5rem;
  }

  .devices {
    grid-area: devices;
  }

  .this-device {
    grid-area: this-device;
  }

  .appearance {
    grid-area: appearance;
  }

  .flux {
    grid-area: flux;
  }

  .agents-editor {
    grid-area: agents;
  }

  .skills-editor {
    grid-area: skills;
  }

  .harness-config {
    grid-area: config;
  }
}
</style>
