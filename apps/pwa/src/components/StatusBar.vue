<script setup lang="ts">
import type { RateWindow } from '@flux/protocol';
import { computed } from 'vue';

import type { ConnectionStatus } from '../client/create-connection.ts';

// Connection state and the agent's rate-limit windows, always visible at the bottom.

const props = defineProps<{
  status: ConnectionStatus;
  daemon: string | null;
  error: string | null;
  rateWindows: RateWindow[];
}>();

const labels: Record<ConnectionStatus, string> = {
  stopped: 'Offline',
  connecting: 'Connecting…',
  no_host: 'Box offline',
  connected: 'Connected',
};

const label = computed(() =>
  props.status === 'connected' && props.daemon !== null
    ? `Connected to ${props.daemon}`
    : labels[props.status],
);

const windows = computed(() =>
  props.rateWindows.map((w) => ({
    name: w.name,
    percent: `${Math.round(w.utilisation * 100)}%`,
    high: w.utilisation >= 0.8,
  })),
);
</script>

<template>
  <footer class="bar">
    <span class="status" :class="status">{{ label }}</span>
    <span v-for="w in windows" :key="w.name" class="window" :class="{ high: w.high }">
      {{ w.name }} {{ w.percent }}
    </span>
    <span v-if="error !== null" class="error">{{ error }}</span>
  </footer>
</template>

<style scoped>
.bar {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  padding: 0.35rem 0.75rem;
  padding-bottom: calc(0.35rem + env(safe-area-inset-bottom));
  border-top: 1px solid var(--border);
  background: var(--panel);
  color: var(--muted);
  font-size: 0.8rem;
}

.status.connected {
  color: var(--ok);
}

.status.no_host,
.status.stopped {
  color: var(--warn);
}

.window.high {
  color: var(--warn);
}

.error {
  color: var(--danger);
  margin-left: auto;
}
</style>
