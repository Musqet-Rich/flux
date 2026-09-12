<script setup lang="ts">
import { computed } from 'vue';

import type { Appearance, Mode } from '../appearance/appearance.ts';
import { appearance as spec } from '../appearance/appearance.ts';

// How the app looks on this device (ADR 0030): light, dark or the system's, and the text size.
// Each applies as it is changed and is kept on the device, so there is no Save and nothing
// goes to the box. A slider for the size rather than a field: on a phone the operator is
// judging the result by eye, and a thumb on a slider does that.

const props = defineProps<{ appearance: Appearance }>();

const mode = computed(() => props.appearance.choices.mode);
const fontSize = computed(() => props.appearance.choices.fontSize);
const { min, max, step } = spec.fontSize;

const labels: Record<Mode, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const modes = spec.modes.map((name) => ({ name, label: labels[name] }));

const pickMode = (event: Event): void => {
  const { target } = event;
  if (!(target instanceof HTMLSelectElement)) return;
  const { value } = target;
  if (spec.isMode(value)) props.appearance.setMode(value);
};

const pickSize = (event: Event): void => {
  const { target } = event;
  if (!(target instanceof HTMLInputElement)) return;
  props.appearance.setFontSize(Number(target.value));
};
</script>

<template>
  <section class="appearance">
    <h2>Appearance</h2>
    <div class="field">
      <label for="flux-mode">Light or dark</label>
      <select id="flux-mode" :value="mode" aria-describedby="flux-mode-hint" @change="pickMode">
        <option v-for="m in modes" :key="m.name" :value="m.name">{{ m.label }}</option>
      </select>
      <p id="flux-mode-hint" class="hint">System follows this device's light or dark setting.</p>
    </div>
    <div class="field">
      <label for="flux-font-size">Text size</label>
      <div class="size">
        <input
          id="flux-font-size"
          type="range"
          :min="min"
          :max="max"
          :step="step"
          :value="fontSize"
          :aria-valuetext="`${fontSize} px`"
          @input="pickSize"
        />
        <output for="flux-font-size" class="value">{{ fontSize }} px</output>
      </div>
    </div>
  </section>
</template>

<style scoped>
h2 {
  font-size: 1rem;
  margin: 0 0 0.5rem;
}

.appearance {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.field {
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

.size {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

/* The slider is a native control: `input` in base.css styles text fields, and a range with a
   panel background and a border is a box with a thumb lost in it. */
input[type='range'] {
  flex: 1;
  background: transparent;
  border: 0;
  padding: 0;
  accent-color: var(--accent);
}

/* Wide enough for `22 px` so the slider does not shift as the number changes. */
.value {
  min-width: 3rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
</style>
