<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';

import { useDismiss } from '../composables/useDismiss.ts';
import Icon from './Icon.vue';
import { writeClipboard } from './write-clipboard.ts';

// The overflow menu on a message bubble: copy the text as written (the agent's Markdown, the
// operator's own typing), or reply to it. Same shape as SessionMenu: a button with
// `aria-haspopup="menu"` and a `role="menu"` list, no library; Escape or a tap elsewhere
// closes it. `side` is the bubble's edge the trigger sits at, which is the inboard one, so it
// is reachable and not under a thumb.

const props = defineProps<{ text: string; side: 'left' | 'right' }>();
const emit = defineEmits<{ reply: [] }>();

const root = ref<HTMLElement | null>(null);
const open = ref(false);
// What the last copy did: the trigger shows a tick or a cross for a moment.
const outcome = ref<'copied' | 'failed' | null>(null);
useDismiss(open, root);
const face = computed(() =>
  outcome.value === 'copied' ? 'check' : outcome.value === 'failed' ? 'failed' : 'menu',
);

const toggle = (): void => {
  open.value = !open.value;
};

// One reset at a time, and none after the timeline's sliding window has unmounted the bubble.
let reset: number | undefined;
const copy = async (): Promise<void> => {
  open.value = false;
  outcome.value = (await writeClipboard(props.text)) ? 'copied' : 'failed';
  window.clearTimeout(reset);
  reset = window.setTimeout(() => {
    outcome.value = null;
  }, 1500);
};
onUnmounted(() => {
  window.clearTimeout(reset);
});

const reply = (): void => {
  open.value = false;
  emit('reply');
};
</script>

<template>
  <div ref="root" class="menu-root" :class="side">
    <button
      type="button"
      class="icon-only trigger"
      :class="outcome"
      aria-haspopup="menu"
      :aria-expanded="open"
      aria-label="Message menu"
      title="Message menu"
      @click="toggle"
    >
      <Icon :name="face" />
    </button>
    <!-- The tick is only a picture; a screen reader hears the outcome here. -->
    <span class="visually-hidden" role="status">{{
      outcome === 'copied' ? 'Copied' : outcome === 'failed' ? 'Copy failed' : ''
    }}</span>
    <div v-if="open" class="menu" role="menu" aria-label="Message">
      <button type="button" role="menuitem" @click="copy"><Icon name="copy" />Copy</button>
      <button type="button" role="menuitem" @click="reply"><Icon name="reply" />Reply</button>
    </div>
  </div>
</template>

<style scoped>
.menu-root {
  position: absolute;
  top: 0.1rem;
}

.left {
  left: 0.1rem;
}

.right {
  right: 0.1rem;
}

.trigger {
  background: transparent;
  color: inherit;
  opacity: 0.6;
  font-size: 1rem;
  line-height: 1;
  padding: 0.2rem 0.35rem;
}

.trigger.copied {
  color: var(--ok);
}

.trigger.failed {
  color: var(--danger);
}

.trigger:hover,
.trigger[aria-expanded='true'] {
  opacity: 1;
}

.menu {
  position: absolute;
  top: calc(100% + 0.2rem);
  z-index: 2;
  min-width: 7rem;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 4px 16px rgb(0 0 0 / 40%);
  overflow: hidden;
}

.left .menu {
  left: 0;
}

.right .menu {
  right: 0;
}

.menu button {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: transparent;
  color: var(--fg);
  border-radius: 0;
  text-align: left;
  padding: 0.6rem 0.9rem;
}

.menu button:hover {
  background: var(--panel-2);
}
</style>
