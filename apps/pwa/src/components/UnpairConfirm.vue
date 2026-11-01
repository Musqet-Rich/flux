<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

import { useEscape } from '../composables/useEscape.ts';
import Icon from './Icon.vue';

// The confirm behind "Unpair this device" (ADR 0037): a modal saying plainly what unpairing
// costs, since getting back needs `flux pair` on the daemon's machine. Cancel, Escape or a tap
// on the backdrop closes it, except while the unpair is under way, which it then says; Cancel
// has the focus, so a stray Enter does nothing drastic.

const emit = defineEmits<{ confirm: []; cancel: [] }>();

const cancelButton = ref<HTMLButtonElement | null>(null);

const props = defineProps<{ name: string; busy: boolean }>();

const cancel = (): void => {
  if (!props.busy) emit('cancel');
};
useEscape(cancel);

// Focus goes back where it came from on close, if that is still on the page (a menu item that
// opened the dialog has gone with its menu).
const opener = document.activeElement;
onUnmounted(() => {
  if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
});

onMounted(() => {
  cancelButton.value?.focus();
});
</script>

<template>
  <div class="backdrop" @click.self="cancel">
    <div
      class="modal"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="unpair-title"
      aria-describedby="unpair-body"
    >
      <h2 id="unpair-title">Unpair this device from {{ name }}?</h2>
      <div id="unpair-body" class="body">
        <p>
          {{ name }} will forget this device. To use it from here again you will need a fresh
          pairing from the daemon's machine: run <code>flux pair</code> there and scan the code it
          prints. That may not be easy to set up again if you are away from that machine.
        </p>
        <p>
          The cached logs and unsent drafts for {{ name }} are removed from this device. This
          device's own settings, such as the theme, the send key and the sound, are kept, and so are
          any other daemons it is paired with.
        </p>
      </div>
      <div class="actions">
        <button ref="cancelButton" type="button" class="secondary" :disabled="busy" @click="cancel">
          Cancel
        </button>
        <button type="button" class="danger" :disabled="busy" @click="emit('confirm')">
          <Icon name="unpair" /> {{ busy ? 'Unpairing…' : 'Unpair' }}
        </button>
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
}

.modal {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
  max-width: 32rem;
  box-sizing: border-box;
  padding: 1rem;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

h2 {
  font-size: 1.05rem;
  margin: 0;
}

.body p {
  margin: 0 0 0.5rem;
  line-height: 1.5;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.danger {
  background: var(--danger);
  color: var(--accent-fg);
}
</style>
