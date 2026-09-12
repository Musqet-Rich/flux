<script setup lang="ts">
import { computed } from 'vue';

import type { Store } from '../store/create-store.ts';
import { sendKey } from '../store/send-key.ts';
import { enterKey } from './enter-key.ts';

// This device's "Send with" choice (store/send-key.ts): a select that applies on change, there
// being nothing to save to the box. Options are named in the device's keyboard's terms, ⌘ and ⌥
// on Apple hardware, Ctrl and Alt elsewhere.

const props = defineProps<{ store: Store }>();

const current = computed(() => props.store.state.sendKey);
const options = sendKey.names.map((name) => ({
  name,
  label: enterKey.label(name, enterKey.apple),
}));

const pick = (event: Event): void => {
  const { target } = event;
  if (!(target instanceof HTMLSelectElement)) return;
  const { value } = target;
  if (sendKey.isName(value)) void props.store.setSendKey(value);
};
</script>

<template>
  <div class="send-key">
    <label for="flux-send-key">Send with</label>
    <select
      id="flux-send-key"
      :value="current"
      aria-describedby="flux-send-key-hint"
      @change="pick"
    >
      <option v-for="o in options" :key="o.name" :value="o.name">{{ o.label }}</option>
    </select>
    <p id="flux-send-key-hint" class="hint">
      Every other Enter starts a new line.
      <template v-if="current === 'enter'">
        A phone keyboard has no modifier keys, so on a phone there is no way to start one.
      </template>
    </p>
  </div>
</template>

<style scoped>
.send-key {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0.25rem 0;
}

.hint {
  color: var(--muted);
  margin: 0;
  font-size: 0.85rem;
}
</style>
