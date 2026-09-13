<script setup lang="ts">
import { computed, ref } from 'vue';

import type { Appearance } from '../appearance/appearance.ts';
import { presets } from '../appearance/presets.ts';
import type { Theme } from '../appearance/theme.ts';
import { theme as spec } from '../appearance/theme.ts';
import { writeClipboard } from './write-clipboard.ts';

// The theme on this device (ADR 0030): the default, a preset, or one pasted in. A theme is
// shared as JSON, so beside the picker are a Copy, which puts the theme in force on the
// clipboard (the default included, which is the template a new theme starts from), and a
// Paste, which takes one from the clipboard, applies it, or says what was wrong with it. A
// pasted theme shows in the picker under its own name, marked so it is not mistaken for a
// preset of the same name, until another is chosen. The fonts are part of the theme JSON
// but picked by FontPicker: a pick here keeps the fonts in force, so what this picker tells
// apart is the colours, and Default with fonts chosen is a copy of the default with them.

const props = defineProps<{ appearance: Appearance }>();

const defaultValue = 'default';
const pastedValue = 'pasted';

const current = computed(() => props.appearance.choices.theme);
const text = computed(() => spec.stringify(current.value ?? spec.default));
// A preset chosen is stored as its own copy, so the one in force is found by its colours.
const all = Object.values(presets);
const same = (a: Theme, b: Theme): boolean =>
  spec.stringify(spec.colours(a)) === spec.stringify(spec.colours(b));
const selected = computed(() => {
  if (current.value === null || same(current.value, spec.default)) return defaultValue;
  return all.find((p) => same(p, current.value ?? p))?.name ?? pastedValue;
});
const options = computed(() => [
  { value: defaultValue, label: 'Default' },
  ...all.map((p) => ({ value: p.name, label: p.name })),
  ...(selected.value === pastedValue
    ? [{ value: pastedValue, label: `${current.value?.name ?? ''} (pasted)` }]
    : []),
]);

const status = ref('');

const pick = (event: Event): void => {
  const { target } = event;
  if (!(target instanceof HTMLSelectElement)) return;
  const { value } = target;
  if (value === pastedValue) return;
  const fonts = current.value?.fonts;
  const picked = all.find((p) => p.name === value);
  if (picked === undefined) {
    props.appearance.setTheme(fonts === undefined ? null : spec.withFonts(spec.default, fonts));
  } else {
    props.appearance.setTheme(spec.withFonts(picked, fonts));
  }
  status.value = '';
};

const copy = async (): Promise<void> => {
  status.value = (await writeClipboard(text.value)) ? 'Copied' : 'Copy failed';
};

// Missing off HTTPS, and refused until the operator allows it (a permission on Chrome, a
// tap on the Paste callout on iOS); either way the answer is on the status line, not a
// rejection.
const readClipboard = async (): Promise<string | null> => {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
};

const paste = async (): Promise<void> => {
  const pasted = await readClipboard();
  if (pasted === null) {
    status.value = 'The clipboard could not be read';
    return;
  }
  const parsed = spec.parse(pasted);
  if (!parsed.ok) {
    status.value = `Not a theme: ${parsed.reason}`;
    return;
  }
  props.appearance.setTheme(parsed.theme);
  status.value = `${parsed.theme.name} applied`;
};
</script>

<template>
  <div class="field">
    <label for="flux-theme">Theme</label>
    <select id="flux-theme" :value="selected" aria-describedby="flux-theme-hint" @change="pick">
      <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
    <p id="flux-theme-hint" class="hint">
      A theme is JSON: Copy shares this one, Paste applies one from the clipboard.
    </p>
    <div class="actions">
      <button type="button" class="secondary" @click="copy">Copy</button>
      <button type="button" class="secondary" @click="paste">Paste</button>
      <span class="status" role="status">{{ status }}</span>
    </div>
  </div>
</template>

<style scoped>
/* The root `.field` is laid out by AppearanceSection's rule, which reaches a child's root; the
   hint inside is not reached, so it is styled again here. */
.hint {
  color: var(--muted);
  margin: 0;
  font-size: 0.85rem;
}

.actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.status {
  color: var(--muted);
  font-size: 0.85rem;
}
</style>
