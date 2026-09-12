<script setup lang="ts">
import { computed } from 'vue';

import type { IconName } from '../icons/icons.ts';
import { icons } from '../icons/icons.ts';

// One Phosphor icon (ADR 0029), drawn inline in `currentColor` at the text size, so it sits in a
// button or a line of text like a character would. Decorative always: the control around it
// carries the accessible name (`aria-label` on an icon-only button, the visible label otherwise).

const props = defineProps<{ name: IconName }>();

const d = computed((): string => icons[props.name]);
</script>

<template>
  <svg class="icon" viewBox="0 0 256 256" :data-icon="name" aria-hidden="true" focusable="false">
    <path :d="d" />
  </svg>
</template>

<style scoped>
.icon {
  width: 1.2em;
  height: 1.2em;
  flex: none;
  fill: currentColor;
  vertical-align: -0.28em;
}
</style>
