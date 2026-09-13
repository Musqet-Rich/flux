<script setup lang="ts">
import { computed } from 'vue';

import type { Appearance } from '../appearance/appearance.ts';
import type { Fonts, Part } from '../appearance/fonts.ts';
import { fonts } from '../appearance/fonts.ts';

// One of the two families on this device (ADR 0030), for text or for code: the platform's
// own, or one of the ten the app ships. A theme pasted in from a device that ships a family
// this one does not names it here, marked, so the operator can see what the JSON asks for;
// the page itself is in the platform's font.

const props = defineProps<{ appearance: Appearance; part: Part }>();

// The platform's own is the one value no family can be: a blank is not a family name.
const platformValue = '';
const labels: Record<Part, string> = { text: 'Text font', code: 'Code font' };
const id = `flux-font-${props.part}`;

const chosen = computed(() => props.appearance.choices.fonts[props.part]);
const options = computed(() => {
  const family = chosen.value;
  const missing = family !== undefined && !fonts.isShipped(props.part, family);
  return [
    { value: platformValue, label: 'System' },
    ...fonts.families[props.part].map((f) => ({ value: f, label: f })),
    ...(missing ? [{ value: family, label: `${family} (not available for ${props.part})` }] : []),
  ];
});

const pick = (event: Event): void => {
  const { target } = event;
  if (!(target instanceof HTMLSelectElement)) return;
  const next: Fonts = {};
  for (const part of fonts.parts) {
    const family = part === props.part ? target.value : props.appearance.choices.fonts[part];
    if (family !== undefined && family !== platformValue) next[part] = family;
  }
  props.appearance.setFonts(next);
};
</script>

<template>
  <div class="field">
    <label :for="id">{{ labels[part] }}</label>
    <select :id="id" :value="chosen ?? platformValue" @change="pick">
      <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
  </div>
</template>
