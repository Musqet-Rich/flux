<script setup lang="ts">
import type { Store } from '../store/create-store.ts';
import { settingsIndex } from './settings-index.ts';
import SendKeyPicker from './SendKeyPicker.vue';
import SoundPicker from './SoundPicker.vue';
import SwitchKeyPicker from './SwitchKeyPicker.vue';

// The choices that belong to this device rather than the box: its notification sound, which
// Enter sends a message and which chord switches session tabs. Each applies as it is changed,
// so there is no Save here. `visible` is the settings search's answer (SettingsView): each
// picker shows while its control's id is in it.

const props = defineProps<{ store: Store; visible: ReadonlySet<string> | null }>();

const show = (id: string): boolean => settingsIndex.isShown(props.visible, id);
</script>

<template>
  <section class="this-device">
    <h2>This device</h2>
    <SoundPicker v-show="show('flux-sound')" data-setting="flux-sound" :store="store" />
    <SendKeyPicker v-show="show('flux-send-key')" data-setting="flux-send-key" :store="store" />
    <SwitchKeyPicker
      v-show="show('flux-switch-key')"
      data-setting="flux-switch-key"
      :store="store"
    />
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
