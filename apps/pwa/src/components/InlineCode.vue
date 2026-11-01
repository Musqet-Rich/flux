<script setup lang="ts">
import { computed, onUnmounted, ref, useTemplateRef } from 'vue';

import { writeClipboard } from './write-clipboard.ts';

// An inline `code` span in a message, copied with one tap: agents put the things worth
// pasting (a path, a command, an id) in backticks, and on a phone selecting a short run by hand
// is fiddly. The span itself is the button, so it costs no room in the line; the tint flashes
// the tick's or the cross's colour for a moment, since a copy has no other visible effect. A
// drag that selects text inside the span is a selection, not a tap, and copies nothing, and
// nor does a double-click (it selects a word) or a held key. Each span is a tab stop, which a
// reply full of them pays for in Tab presses; reaching any one from the keyboard is worth it.

const props = defineProps<{ text: string }>();

const outcome = ref<'copied' | 'failed' | null>(null);
const said = computed(() =>
  outcome.value === 'copied' ? 'Copied' : outcome.value === 'failed' ? 'Copy failed' : '',
);
// Bound as an object, like CodeBlock.vue's: the renderer's injection test checks every class.
const attrs = computed(() => ({
  class: outcome.value === null ? 'copyable' : `copyable ${outcome.value}`,
  title: said.value === '' ? 'Copy' : said.value,
}));

const el = useTemplateRef<HTMLElement>('el');
const selecting = (): boolean => {
  const selection = window.getSelection();
  return (
    selection !== null &&
    !selection.isCollapsed &&
    el.value !== null &&
    (el.value.contains(selection.anchorNode) || el.value.contains(selection.focusNode))
  );
};

// The second click of a double-click selects a word; a modified key (Ctrl+Enter, Shift+Space)
// means something else; a held one repeats.
const another = (event: MouseEvent | KeyboardEvent): boolean =>
  event instanceof MouseEvent
    ? event.detail > 1
    : event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;

// One reset at a time, as in CodeBlock.vue: a second tap restarts the moment, and the
// timeline's sliding window can unmount the span before the timer fires.
let reset: number | undefined;
const copy = async (event: MouseEvent | KeyboardEvent): Promise<void> => {
  if (another(event) || selecting()) return;
  outcome.value = (await writeClipboard(props.text)) ? 'copied' : 'failed';
  window.clearTimeout(reset);
  reset = window.setTimeout(() => {
    outcome.value = null;
  }, 1500);
};
onUnmounted(() => {
  window.clearTimeout(reset);
});
</script>

<template>
  <code
    ref="el"
    v-bind="attrs"
    role="button"
    tabindex="0"
    aria-description="Copy"
    @click="copy"
    @keydown.enter.prevent="copy"
    @keydown.space.prevent="copy"
    >{{ text }}</code
  ><!-- The tint is only a colour; a screen reader hears the outcome here. --><span
    class="visually-hidden"
    role="status"
    >{{ said }}</span
  >
</template>

<style scoped>
.copyable {
  cursor: pointer;
  transition:
    color 0.15s,
    box-shadow 0.15s;
}

/* Hover only where there is a pointer that hovers: a phone keeps `:hover` on the last tap. */
@media (hover: hover) {
  .copyable:hover {
    box-shadow: inset 0 0 0 1px currentcolor;
  }
}

.copyable.copied {
  color: var(--ok);
  box-shadow: inset 0 0 0 1px var(--ok);
}

.copyable.failed {
  color: var(--danger);
  box-shadow: inset 0 0 0 1px var(--danger);
}
</style>
