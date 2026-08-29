<script setup lang="ts">
import { computed, ref } from 'vue';

import type { Store } from '../store/create-store.ts';

// Paired devices with a two-tap revoke: the first tap asks, the second does it. Revoking this
// device is allowed and lands on the pair screen.

const props = defineProps<{ store: Store }>();

const confirming = ref<string | null>(null);
const busy = ref(false);

const when = (iso: string | undefined): string =>
  iso === undefined ? 'never' : new Date(iso).toLocaleString();

const question = (current: boolean, last: boolean): string => {
  if (last) return 'This is the last device; you will need `flux pair` on the box to reconnect.';
  return current ? 'Revoke your own device? You will need to pair again.' : 'Revoke?';
};

const rows = computed(() => {
  const last = props.store.state.devices.length === 1;
  return props.store.state.devices.map((d) => ({
    deviceId: d.deviceId,
    label: d.name ?? d.deviceId,
    current: d.current,
    paired: when(d.pairedAt),
    seen: when(d.lastSeenAt),
    confirming: confirming.value === d.deviceId,
    question: question(d.current, last),
  }));
});

const ask = (deviceId: string): void => {
  confirming.value = deviceId;
};
const cancel = (): void => {
  confirming.value = null;
};
const revoke = async (deviceId: string): Promise<void> => {
  busy.value = true;
  await props.store.removeDevice(deviceId);
  busy.value = false;
  confirming.value = null;
};
</script>

<template>
  <section class="devices">
    <h2>Devices</h2>
    <p v-if="rows.length === 0" class="hint">No devices yet.</p>
    <ul v-else class="list">
      <li v-for="d in rows" :key="d.deviceId" class="device">
        <div class="who">
          <span class="label">{{ d.label }}</span>
          <span v-if="d.current" class="current">this device</span>
          <span class="id">{{ d.deviceId }}</span>
        </div>
        <div class="meta">paired {{ d.paired }} · last seen {{ d.seen }}</div>
        <div v-if="d.confirming" class="confirm">
          <span>{{ d.question }}</span>
          <button type="button" class="danger" :disabled="busy" @click="revoke(d.deviceId)">
            Confirm
          </button>
          <button type="button" class="secondary" :disabled="busy" @click="cancel">Cancel</button>
        </div>
        <button v-else type="button" class="secondary revoke" @click="ask(d.deviceId)">
          Revoke
        </button>
      </li>
    </ul>
    <p class="hint">
      Pair another device: run <code>flux pair</code> on the box and scan the QR code with it.
    </p>
  </section>
</template>

<style scoped>
h2 {
  font-size: 1rem;
  margin: 0 0 0.5rem;
}

.hint {
  color: var(--muted);
  margin: 0.5rem 0 0;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.device {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 0.75rem;
  align-items: center;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--panel);
}

.who {
  flex: 1;
  min-width: 10rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: baseline;
}

.current {
  color: var(--ok);
  font-size: 0.8rem;
}

.id,
.meta {
  color: var(--muted);
  font-size: 0.8rem;
  overflow-wrap: anywhere;
}

.meta {
  width: 100%;
}

.confirm {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  width: 100%;
}

.danger {
  background: var(--danger);
}
</style>
