<script setup lang="ts">
import { computed, ref } from 'vue';

import type { Store } from '../store/create-store.ts';
import { daemonLabels } from './daemon-labels.ts';
import Icon from './Icon.vue';
import PairDaemonDialog from './PairDaemonDialog.vue';
import { settingsIndex } from './settings-index.ts';
import SendKeyPicker from './SendKeyPicker.vue';
import SoundPicker from './SoundPicker.vue';
import SwitchKeyPicker from './SwitchKeyPicker.vue';
import UnpairConfirm from './UnpairConfirm.vue';

// The choices that belong to this device rather than the box: its notification sound, which
// Enter sends a message and which chord switches session tabs. Each applies as it is changed,
// so there is no Save here. Then the daemons it is paired with (ADR 0037): pairing another,
// which is here as well as in the header's picker since the picker only shows once two are
// paired, and unpairing from the open one, behind a confirm. `visible` is the settings search's
// answer (SettingsView): each part shows while its control's id is in it.

const props = defineProps<{ store: Store; visible: ReadonlySet<string> | null }>();

const show = (id: string): boolean => settingsIndex.isShown(props.visible, id);

const pairing = ref(false);
const confirming = ref(false);
const busy = ref(false);

const name = computed(() => {
  const { daemons, activeDaemon } = props.store.state;
  return activeDaemon === null ? null : (daemonLabels(daemons).get(activeDaemon) ?? null);
});

const unpair = async (): Promise<void> => {
  busy.value = true;
  await props.store.unpairDevice();
  busy.value = false;
  confirming.value = false;
};
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
    <div v-show="show('flux-daemons')" data-setting="flux-daemons" class="daemons">
      <p v-if="name !== null" class="hint">Paired with {{ name }}.</p>
      <div class="buttons">
        <button type="button" class="secondary" @click="pairing = true">
          <Icon name="plus" /> Pair another daemon
        </button>
        <button
          v-if="name !== null"
          type="button"
          class="secondary unpair"
          @click="confirming = true"
        >
          <Icon name="unpair" /> Unpair this device
        </button>
      </div>
    </div>
    <PairDaemonDialog v-if="pairing" :store="store" @close="pairing = false" />
    <UnpairConfirm
      v-if="confirming && name !== null"
      :name="name"
      :busy="busy"
      @confirm="unpair"
      @cancel="confirming = false"
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

.hint {
  color: var(--muted);
  margin: 0 0 0.5rem;
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.unpair {
  color: var(--danger);
}
</style>
