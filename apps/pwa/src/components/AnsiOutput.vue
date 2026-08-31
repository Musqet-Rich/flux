<script setup lang="ts">
import type { VNode } from 'vue';

import { renderAnsi } from '../ansi/render-ansi.ts';

// A command's streamed output, its ANSI colour rendered to styled spans (ADR 0026). The <pre>
// preserves the layout; the spans carry only fixed, parsed colours as inline styles, never markup.
const props = defineProps<{ text: string }>();

const Ansi = (): VNode => renderAnsi(props.text);
</script>

<template>
  <pre class="output"><Ansi /></pre>
</template>

<style scoped>
.output {
  margin: 0;
  padding: 0.5rem 0.6rem;
  background: var(--bg);
  border-radius: var(--radius);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
  line-height: 1.35;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
}
</style>
