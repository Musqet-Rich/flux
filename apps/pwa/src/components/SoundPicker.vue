<script setup lang="ts">
import { computed } from 'vue';

import { notificationSounds } from '../sound/notification-sounds.ts';
import type { Store } from '../store/create-store.ts';

// This device's notification sound (store/notification-sound.ts): a select that applies on
// change and plays the pick, so the operator hears it under the tap the browser needs, and a
// Play button to hear it again. Device-local, so it sits apart from the box's Save, in the
// "This device" section.

const props = defineProps<{ store: Store }>();

const sound = computed(() => props.store.state.sound);

const pick = (event: Event): void => {
  const { target } = event;
  if (!(target instanceof HTMLSelectElement)) return;
  const { value } = target;
  if (notificationSounds.isName(value)) void props.store.setSound(value);
};

const replay = (): void => {
  props.store.playSound();
};
</script>

<template>
  <div class="sound">
    <label for="flux-sound">Notification sound</label>
    <span class="controls">
      <select id="flux-sound" :value="sound" @change="pick">
        <option v-for="o in notificationSounds.options" :key="o.name" :value="o.name">
          {{ o.label }}
        </option>
      </select>
      <button type="button" class="secondary" :disabled="sound === 'none'" @click="replay">
        Play
      </button>
    </span>
    <p class="hint">
      For browsers where notifications do not arrive: rings while the app is open, at the phone's
      media volume (silent with the mute switch on).
    </p>
  </div>
</template>

<style scoped>
.sound {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0.25rem 0;
}

.controls {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.controls select {
  flex: 1;
}

.hint {
  color: var(--muted);
  margin: 0;
  font-size: 0.85rem;
}
</style>
