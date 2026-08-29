<script setup lang="ts">
import { ref } from 'vue';

import { useDismiss } from '../composables/useDismiss.ts';

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

const toggle = (): void => {
  open.value = !open.value;
};

// The async clipboard is missing off HTTPS (a box reached over plain http on the LAN) and
// can be refused; neither is worth an unhandled rejection, so the button reports instead.
const writeClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

const copy = async (): Promise<void> => {
  open.value = false;
  outcome.value = (await writeClipboard(props.text)) ? 'copied' : 'failed';
  setTimeout(() => {
    outcome.value = null;
  }, 1500);
};

const reply = (): void => {
  open.value = false;
  emit('reply');
};
</script>

<template>
  <div ref="root" class="menu-root" :class="side">
    <button
      type="button"
      class="trigger"
      :class="outcome"
      aria-haspopup="menu"
      :aria-expanded="open"
      aria-label="Message menu"
      @click="toggle"
    />
    <div v-if="open" class="menu" role="menu" aria-label="Message">
      <button type="button" role="menuitem" @click="copy">Copy</button>
      <button type="button" role="menuitem" @click="reply">Reply</button>
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
  padding: 0.2rem 0.45rem;
}

.trigger::before {
  content: '⋯';
}

.trigger.copied::before {
  content: '✓';
}

.trigger.failed::before {
  content: '✕';
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
