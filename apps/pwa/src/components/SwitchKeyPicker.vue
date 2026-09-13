<script setup lang="ts">
import { computed } from 'vue';

import type { Store } from '../store/create-store.ts';
import { switchKey } from '../store/switch-key.ts';
import { switchChord } from './switch-chord.ts';

// This device's "Switch tabs with" choice (store/switch-key.ts): a select that applies on
// change, there being nothing to save to the box. Options are named in the device's keyboard's
// terms, and each chord's cost elsewhere (a text box's caret, the browser's own shortcut) is
// the hint under it, since every arrow chord has one but the default. On a PC ⌘⌥ and ⌃⌥ are
// the same keys, so a ⌘⌥ choice made on a Mac shows as the ⌃⌥ row there.

const props = defineProps<{ store: Store }>();

const { apple } = switchChord;
const current = computed(() =>
  props.store.state.switchKey === 'metaAlt' && !apple ? 'ctrlAlt' : props.store.state.switchKey,
);
const options = switchChord.offered(apple).map((name) => ({
  name,
  label: switchChord.label(name, apple),
}));
const hint = computed(() => switchChord.hint(current.value, apple));

const pick = (event: Event): void => {
  const { target } = event;
  if (!(target instanceof HTMLSelectElement)) return;
  const { value } = target;
  if (switchKey.isName(value)) void props.store.setSwitchKey(value);
};
</script>

<template>
  <div class="switch-key">
    <label for="flux-switch-key">Switch tabs with</label>
    <select
      id="flux-switch-key"
      :value="current"
      aria-describedby="flux-switch-key-hint"
      @change="pick"
    >
      <option v-for="o in options" :key="o.name" :value="o.name">{{ o.label }}</option>
    </select>
    <p id="flux-switch-key-hint" class="hint">
      Steps along the session tabs, wrapping at the ends.
      <template v-if="hint !== ''">{{ hint }}</template>
    </p>
  </div>
</template>

<style scoped>
.switch-key {
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
