<script setup lang="ts">
import type { VNode } from 'vue';

import { renderMarkdown } from '../markdown/render-markdown.ts';

// The main agent's bubble in progress, at the end of the timeline's rows: the reply as it streams, or the
// thinking indicator before any text, and the indeterminate Compacting indicator while a
// /compact turn runs (SessionView computes the three, SessionTimeline shows this on main only).

const props = defineProps<{ streaming: string; thinking: string | null; compacting: boolean }>();

// The delta buffer renders through the same Markdown pass as the final message, so an open
// fence is a code block from its first line and the bubble never flickers back to raw text.
const Streaming = (): VNode => renderMarkdown(props.streaming);
</script>

<template>
  <article v-if="streaming !== '' || thinking !== null" class="streaming">
    <Streaming v-if="streaming !== ''" />
    <span v-else class="thinking"><span class="loader" aria-hidden="true" />{{ thinking }}</span>
  </article>
  <article v-if="compacting" class="streaming compacting">
    <span class="thinking"><span class="loader" aria-hidden="true" />Compacting…</span>
  </article>
</template>

<style scoped>
.streaming {
  align-self: flex-start;
  background: var(--panel-2);
  border-radius: var(--radius);
  padding: 0.6rem 0.8rem;
  max-width: 85%;
  opacity: 0.8;
}

.thinking {
  color: var(--muted);
  font-style: italic;
}

.thinking .loader {
  margin-right: 0.5rem;
}
</style>
