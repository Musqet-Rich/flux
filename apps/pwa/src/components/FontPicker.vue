<script setup lang="ts">
import { computed } from 'vue';

import type { Appearance } from '../appearance/appearance.ts';
import type { Fonts, Part } from '../appearance/fonts.ts';
import { fonts } from '../appearance/fonts.ts';
import { theme as spec } from '../appearance/theme.ts';

// One of the two families on this device (ADR 0030), for text or for code: the platform's
// own, or one of the ten the app ships. The families are part of the theme JSON, so a pick
// is the theme in force with this family in it (a copy of the default, when Default is in
// force), and ThemePicker still shows the colours as the preset they are. A theme pasted in
// from a device that ships a family this one does not names it here, marked, so the
// operator can see what the JSON asks for; the page itself is in the platform's font.

const props = defineProps<{ appearance: Appearance; part: Part }>();

const systemValue = 'system';
const labels: Record<Part, string> = { text: 'Text font', code: 'Code font' };
const id = `flux-font-${props.part}`;

const current = computed(() => props.appearance.choices.theme?.fonts ?? {});
const chosen = computed(() => current.value[props.part]);
const selected = computed(() => chosen.value ?? systemValue);
const options = computed(() => {
  const family = chosen.value;
  const missing = family !== undefined && !fonts.isShipped(props.part, family);
  return [
    { value: systemValue, label: 'System' },
    ...fonts.families[props.part].map((f) => ({ value: f, label: f })),
    ...(missing ? [{ value: family, label: `${family} (not available)` }] : []),
  ];
});

const pick = (event: Event): void => {
  const { target } = event;
  if (!(target instanceof HTMLSelectElement)) return;
  const { value } = target;
  const next: Fonts = {};
  for (const part of fonts.parts) {
    const family = part === props.part ? value : current.value[part];
    if (family !== undefined && family !== systemValue) next[part] = family;
  }
  const base = props.appearance.choices.theme ?? spec.default;
  props.appearance.setTheme(
    spec.withFonts(base, Object.keys(next).length === 0 ? undefined : next),
  );
};
</script>

<template>
  <div class="field">
    <label :for="id">{{ labels[part] }}</label>
    <select :id="id" :value="selected" @change="pick">
      <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
  </div>
</template>
