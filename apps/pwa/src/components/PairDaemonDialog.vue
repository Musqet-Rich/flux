<script setup lang="ts">
import { onMounted, onScopeDispose, ref } from 'vue';

import { useEscape } from '../composables/useEscape.ts';
import type { Store } from '../store/create-store.ts';
import Pair from './Pair.vue';

// "Pair another daemon" (ADR 0037): the pair screen's own scan-or-paste card in a modal over the
// app, so a second daemon pairs while the open one stays open. On success the new daemon is
// the open one and the dialog closes; on failure it stays with the reason. Cancel, Escape or a
// tap on the backdrop closes it and abandons a pairing still under way (until the daemon has
// accepted the device, after which the pairing completes anyway).

const props = defineProps<{ store: Store }>();
const emit = defineEmits<{ close: [] }>();

const busy = ref(false);
const failure = ref<string | null>(null);
const dialog = ref<HTMLElement | null>(null);
let abort: AbortController | null = null;

const close = (): void => {
  abort?.abort();
  emit('close');
};
useEscape(close);

const pair = async (relayUrl: string, fragment: string): Promise<void> => {
  busy.value = true;
  failure.value = null;
  abort = new AbortController();
  const ok = await props.store.pair(relayUrl, fragment, abort.signal);
  const cancelled = abort.signal.aborted;
  abort = null;
  busy.value = false;
  if (ok) emit('close');
  else if (!cancelled) failure.value = props.store.state.error?.message ?? 'Pairing failed.';
};

onMounted(() => {
  dialog.value?.focus();
});
onScopeDispose(() => {
  abort?.abort();
});
</script>

<template>
  <div class="backdrop" @click.self="close">
    <div
      ref="dialog"
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Pair another daemon"
      tabindex="-1"
    >
      <Pair
        :phase="busy ? 'pairing' : 'unpaired'"
        :error="failure"
        heading-tag="h2"
        another
        @pair="pair"
      />
      <div class="actions">
        <button type="button" class="secondary" @click="close">Cancel</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: calc(2rem + env(safe-area-inset-top)) 1rem calc(1rem + env(safe-area-inset-bottom));
  background: rgb(0 0 0 / 60%);
  overflow-y: auto;
}

/* The pair card's own dark look, as on the landing page (Home.vue), whatever the device's scheme. */
.modal {
  --flux-accent: oklch(0.85 0.19 145);
  --flux-mono: 'IBM Plex Mono', ui-monospace, Menlo, monospace;
  color-scheme: dark;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
  max-width: 32rem;
  box-sizing: border-box;
  padding: 1.25rem;
  background: oklch(0.13 0.01 150);
  color: oklch(0.88 0.02 150);
  border: 1px solid oklch(0.32 0.04 150);
  border-radius: var(--radius);
  outline: none;
}

.actions {
  display: flex;
  justify-content: flex-end;
}
</style>
