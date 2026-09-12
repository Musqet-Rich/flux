<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';

import Icon from './Icon.vue';
import { writeClipboard } from './write-clipboard.ts';

// A fenced code block in a message, with a one-tap Copy in its corner. The button is always
// visible: on a phone there is no hover to reveal it with. It copies the fence body as written,
// nothing of the fence line and no trailing newline (pasted into a terminal, a command should
// wait for the operator, not run), and shows a tick or a cross for a moment, since a copy has
// no other visible effect. An open fence (still streaming) has no button, its text is not
// done, and neither does an empty one.

const props = defineProps<{ text: string; lang: string; closed: boolean }>();

// Bound as objects: a template `:class` with nothing to say still writes an empty `class=""`,
// which the renderer's injection test counts as an attribute the text put there.
const preAttrs = computed(() => (props.closed ? {} : { class: 'open' }));
const codeAttrs = computed(() => (props.lang === '' ? {} : { class: `language-${props.lang}` }));
// A reply can hold several blocks; the language tells them apart for a screen reader.
const name = computed(() => (props.lang === '' ? 'Copy code' : `Copy ${props.lang} code`));

const outcome = ref<'copied' | 'failed' | null>(null);
const face = computed(() =>
  outcome.value === 'copied' ? 'check' : outcome.value === 'failed' ? 'failed' : 'copy',
);
const title = computed(() =>
  outcome.value === 'copied' ? 'Copied' : outcome.value === 'failed' ? 'Copy failed' : 'Copy',
);

// One reset at a time: a second tap restarts the moment rather than being cut short by the
// first tap's timer, and the timeline's sliding window can unmount the block before it fires.
let reset: number | undefined;
const copy = async (): Promise<void> => {
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
  <div class="code-block">
    <!-- On one line: whitespace inside a `pre` is content. -->
    <pre v-bind="preAttrs"><code v-bind="codeAttrs">{{ text }}</code></pre>
    <template v-if="closed && text !== ''">
      <button
        type="button"
        class="icon-only copy"
        :class="outcome"
        :aria-label="name"
        :title="title"
        @click="copy"
      >
        <Icon :name="face" />
      </button>
      <!-- The tick is only a picture; a screen reader hears the outcome here. -->
      <span class="visually-hidden" role="status">{{ outcome === null ? '' : title }}</span>
    </template>
  </div>
</template>

<style scoped>
.code-block {
  position: relative;
}

/* Room for the button: a float, so only the line boxes it overlaps wrap short of it and the
   lines below keep the width a right padding would take from every one. Sized from the
   button's own box (offset, padding, icon), not the code font, so the two cannot drift apart.
   An open fence has no button and reserves nothing. */
.code-block pre:not(.open)::before {
  content: '';
  float: right;
  width: 2.5rem;
  height: 2.2rem;
}

.copy {
  position: absolute;
  top: 0.15rem;
  right: 0.15rem;
  background: transparent;
  color: inherit;
  opacity: 0.6;
  font-size: 1rem;
  padding: 0.4rem 0.55rem;
}

.copy:hover,
.copy:focus-visible {
  opacity: 1;
}

.copy.copied {
  color: var(--ok);
  opacity: 1;
}

.copy.failed {
  color: var(--danger);
  opacity: 1;
}
</style>
