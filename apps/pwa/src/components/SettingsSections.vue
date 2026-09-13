<script setup lang="ts">
import { computed } from 'vue';

import type { Store } from '../store/create-store.ts';
import AgentsEditor from './AgentsEditor.vue';
import AppearanceSection from './AppearanceSection.vue';
import DevicesSection from './DevicesSection.vue';
import FluxSettingsForm from './FluxSettingsForm.vue';
import HarnessConfigEditor from './HarnessConfigEditor.vue';
import { settingsIndex } from './settings-index.ts';
import SkillsEditor from './SkillsEditor.vue';
import ThisDeviceSection from './ThisDeviceSection.vue';

// The settings sections and their layout: paired devices, this device's own choices, how the
// app looks on it (ADR 0030), the box's runtime settings, and the agent's saved Agents, skills
// and global config. `visible` is the search's answer (SettingsView, settings-index.ts): a
// section shows while its id is in it, everything while it is null, and `query` is what was
// typed, for the notice when nothing matches. The editors are shown or hidden whole: hiding
// a row of one would hide an unsaved edit.

const props = defineProps<{ store: Store; visible: ReadonlySet<string> | null; query: string }>();

const show = (id: string): boolean => settingsIndex.isShown(props.visible, id);
const noMatch = computed(() => props.visible !== null && props.visible.size === 0);
</script>

<template>
  <div class="sections" :class="{ filtered: visible !== null }">
    <p v-if="noMatch" class="hint no-match" role="status">Nothing matches “{{ query }}”.</p>
    <DevicesSection
      v-show="show('devices')"
      data-setting="devices"
      :store="store"
      :visible="visible"
    />
    <ThisDeviceSection
      v-show="show('this-device')"
      data-setting="this-device"
      :store="store"
      :visible="visible"
    />
    <AppearanceSection
      v-show="show('appearance')"
      data-setting="appearance"
      :appearance="store.appearance"
      :visible="visible"
    />
    <FluxSettingsForm v-show="show('flux')" data-setting="flux" :store="store" :visible="visible" />
    <AgentsEditor v-show="show('agents')" data-setting="agents" :store="store" />
    <SkillsEditor v-show="show('skills')" data-setting="skills" :store="store" />
    <HarnessConfigEditor
      v-show="show('harness-config')"
      data-setting="harness-config"
      :store="store"
    />
  </div>
</template>

<style scoped>
.hint {
  color: var(--muted);
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
   adding one cannot shuffle the others. While a search is filtering, the sections flow into
   the two columns instead, the editors across both: a hidden section would otherwise leave
   its named row's gap behind. */
@media (min-width: 56rem) {
  .sections {
    max-width: 76rem;
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-items: start;
    gap: 1.5rem;
  }

  .sections:not(.filtered) {
    grid-template-areas:
      'devices flux'
      'this-device flux'
      'appearance flux'
      'agents agents'
      'skills skills'
      'config config';
  }

  .sections:not(.filtered) .devices {
    grid-area: devices;
  }

  .sections:not(.filtered) .this-device {
    grid-area: this-device;
  }

  .sections:not(.filtered) .appearance {
    grid-area: appearance;
  }

  .sections:not(.filtered) .flux {
    grid-area: flux;
  }

  .sections:not(.filtered) .agents-editor {
    grid-area: agents;
  }

  .sections:not(.filtered) .skills-editor {
    grid-area: skills;
  }

  .sections:not(.filtered) .harness-config {
    grid-area: config;
  }

  .filtered .agents-editor,
  .filtered .skills-editor,
  .filtered .harness-config,
  .no-match {
    grid-column: 1 / -1;
  }
}
</style>
