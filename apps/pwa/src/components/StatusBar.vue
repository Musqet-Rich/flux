<script setup lang="ts">
import type { RateWindow } from '@flux/protocol';
import { computed, onMounted, onUnmounted, ref } from 'vue';

import type { ConnectionStatus } from '../client/create-connection.ts';
import type { PushState, SessionContext } from '../store/store-state.ts';
import { formatRenewal } from './format-renewal.ts';

// Connection state, the open session's context-window usage, the agent's rate-limit windows and
// their renewal times, the way to turn notifications on and the last error with a × to dismiss
// it, always visible at the bottom.

const props = withDefaults(
  defineProps<{
    status: ConnectionStatus;
    daemon: string | null;
    error: string | null;
    push: PushState;
    rateWindows: RateWindow[];
    // The open session's context window, or null off a session or before the first model call.
    context?: SessionContext | null;
  }>(),
  { context: null },
);
defineEmits<{ enablePush: []; dismiss: [] }>();

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

// A running clock, ticked once a minute, so a window's renewal counts down without a reload.
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now();
  }, 60_000);
});
onUnmounted(() => {
  if (timer !== null) clearInterval(timer);
});

// `ctx 239k` always, plus `· 24%` when the box knew the model's window; the percentage warns in
// amber from 70% and red from 90% (the tokens the tools already use, base.css).
const ctxLevel = (pct: number): string => {
  if (pct >= 90) return 'red';
  if (pct >= 70) return 'amber';
  return '';
};

const ctx = computed(() => {
  const c = props.context;
  if (c === null) return null;
  const tokens = c.tokens >= 1000 ? `${Math.round(c.tokens / 1000)}k` : String(c.tokens);
  if (c.window === null || c.window <= 0) return { text: `ctx ${tokens}`, level: '' };
  const pct = Math.round((c.tokens / c.window) * 100);
  return { text: `ctx ${tokens} · ${pct}%`, level: ctxLevel(pct) };
});

// The agent names its windows on the wire (`five_hour`, `seven_day`, ...). The two known ones
// get a short label; any other only earns a place on a phone-width bar when it is the most used,
// which is the one the operator needs to know about.
const shortNames: Record<string, string> = { five_hour: '5h', seven_day: '7d' };

const windows = computed(() => {
  const max = Math.max(...props.rateWindows.map((w) => w.utilisation));
  return props.rateWindows
    .filter((w) => Object.hasOwn(shortNames, w.name) || w.utilisation === max)
    .map((w) => ({
      name: w.name,
      label: shortNames[w.name] ?? w.name.replaceAll('_', ' '),
      percent: `${Math.round(w.utilisation * 100)}%`,
      high: w.utilisation >= 0.8,
      renew: formatRenewal(w.resetsAt, now.value),
      // The binding window is the most used one: its renewal is the one that matters, so it is
      // the last to go when the bar is narrow (the style block drops the others first).
      binding: w.utilisation === max,
      resetsAt: w.resetsAt,
    }));
});

// Tapping the group adds one line of absolute local times under the relative renewals.
const expanded = ref(false);
const toggle = (): void => {
  expanded.value = !expanded.value;
};

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const localTime = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : timeFormat.format(date);
};

const absolute = computed(() =>
  windows.value
    .map((w) => ({ label: w.label, time: localTime(w.resetsAt) }))
    .filter((w) => w.time !== ''),
);
</script>

<template>
  <footer class="bar">
    <span class="status" :class="status">{{ label }}</span>
    <span v-if="ctx !== null" class="ctx" :class="ctx.level">{{ ctx.text }}</span>
    <span v-if="windows.length > 0" class="windows" @click="toggle">
      <span v-for="w in windows" :key="w.name" class="win-group">
        <span class="window" :class="{ high: w.high }">{{ w.label }} {{ w.percent }}</span>
        <span v-if="w.renew !== ''" class="renew" :class="{ binding: w.binding }">
          ↻ {{ w.renew }}</span
        >
      </span>
    </span>
    <span v-if="expanded && absolute.length > 0" class="absolute">
      <span v-for="w in absolute" :key="w.label" class="at">{{ w.label }} {{ w.time }}</span>
    </span>
    <button v-if="push === 'off'" type="button" class="secondary push" @click="$emit('enablePush')">
      Enable notifications
    </button>
    <span v-if="error !== null" class="error" role="alert">
      {{ error }}
      <button type="button" class="dismiss" aria-label="Dismiss error" @click="$emit('dismiss')">
        ×
      </button>
    </span>
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

.ctx {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.ctx.amber {
  color: var(--warn);
}

.ctx.red {
  color: var(--danger);
}

/* One unbroken run, `5h 13% ↻ 2h10m · 7d 24% ↻ 11h`, tapped for a line of absolute times. */
.windows {
  white-space: nowrap;
  cursor: pointer;
}

/* On a phone-width bar the whole run would wrap under the connection and context readings, so
   the renewals of the non-binding windows go first and only the most used window keeps its
   `↻`. A breakpoint rather than a measurement: the bar's other occupants are fixed-size and
   the phone is where the space runs out. */
@media (max-width: 480px) {
  .renew:not(.binding) {
    display: none;
  }
}

.win-group + .win-group::before {
  content: ' · ';
}

.window.high {
  color: var(--warn);
}

.renew {
  color: var(--muted);
}

.absolute {
  white-space: nowrap;
}

.at + .at::before {
  content: ' · ';
}

.push {
  padding: 0.2rem 0.6rem;
  font-size: 0.8rem;
}

.error {
  color: var(--danger);
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.dismiss {
  background: transparent;
  color: inherit;
  font-size: 1rem;
  line-height: 1;
  padding: 0 0.3rem;
}
</style>
