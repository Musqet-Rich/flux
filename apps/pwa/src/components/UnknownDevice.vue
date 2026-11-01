<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import type { Store } from '../store/create-store.ts';
import { daemonLabels } from './daemon-labels.ts';
import Icon from './Icon.vue';

// The banner for an open daemon that no longer knows this device (ADR 0037): it answered
// `not_paired`, or the relay says it is there but it never answers this device's handshake,
// which a daemon does once the device was revoked from elsewhere, and which a daemon whose
// network dropped without the relay noticing looks like for a while. Rather than sit on "connecting" it says so, and
// offers Forget, which removes the pairing here alone (nothing is asked of a daemon that has
// already forgotten the device) and opens the next daemon or the pair screen. Forget asks once
// more first, since a daemon that is only slow to answer would be forgotten too.

const props = defineProps<{ store: Store }>();

const confirming = ref(false);
const busy = ref(false);
const cancelButton = ref<HTMLButtonElement | null>(null);

const reason = computed(() => props.store.state.unknownDevice);
const name = computed(() => {
  const { daemons, activeDaemon } = props.store.state;
  const label = activeDaemon === null ? undefined : daemonLabels(daemons).get(activeDaemon);
  return label ?? 'This daemon';
});

const advice = computed(() =>
  reason.value === 'not_paired'
    ? 'Forget it here to remove the pairing.'
    : 'If it has forgotten the device, forget it here to stop trying.',
);

// Another daemon opened, or this one answered after all: start from the first tap again.
watch(reason, () => {
  confirming.value = false;
});

// The button that asked is gone once the confirm shows; the focus goes to its Cancel.
watch(confirming, async (on) => {
  if (!on) return;
  await nextTick();
  cancelButton.value?.focus();
});

const forget = async (): Promise<void> => {
  busy.value = true;
  await props.store.forgetDaemon();
  busy.value = false;
  confirming.value = false;
};
</script>

<template>
  <section v-if="reason !== null" class="unknown" aria-label="Daemon problem">
    <p v-if="reason === 'not_paired'" class="what" role="alert">
      {{ name }} no longer knows this device.
    </p>
    <p v-else class="what" role="alert">
      {{ name }} is not answering this device. It may be offline or asleep, or it may have forgotten
      this device because it was revoked from another device, in which case it never will answer.
    </p>
    <p class="hint">
      {{ advice }}
      Using it from this device again needs a fresh pairing: <code>flux pair</code> on the daemon's
      machine.
    </p>
    <div v-if="confirming" class="actions">
      <span>Forget {{ name }} on this device?</span>
      <button type="button" class="danger" :disabled="busy" @click="forget">Forget</button>
      <button
        ref="cancelButton"
        type="button"
        class="secondary"
        :disabled="busy"
        @click="confirming = false"
      >
        Cancel
      </button>
    </div>
    <div v-else class="actions">
      <button type="button" class="secondary forget" @click="confirming = true">
        <Icon name="unpair" /> Forget {{ name }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.unknown {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.6rem 0.9rem;
  background: var(--panel-2);
  border-bottom: 1px solid var(--border);
}

.what,
.hint {
  margin: 0;
}

.what {
  color: var(--warn);
}

.hint {
  color: var(--muted);
  font-size: 0.9rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.forget {
  color: var(--danger);
}

.danger {
  background: var(--danger);
  color: var(--accent-fg);
}
</style>
