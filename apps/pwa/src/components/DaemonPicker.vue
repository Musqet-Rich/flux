<script setup lang="ts">
import { computed, ref } from 'vue';

import { useDismiss } from '../composables/useDismiss.ts';
import type { Store } from '../store/create-store.ts';
import { daemonLabels } from './daemon-labels.ts';
import Icon from './Icon.vue';
import PairDaemonDialog from './PairDaemonDialog.vue';

// The header's daemon picker (ADR 0037), there once two or more daemons are paired: the open
// daemon's name opens a menu of the others to switch to, and "Pair another daemon". Switching
// lets the open daemon go and opens the chosen one (Shell goes to its sessions). A daemon here,
// never a box: several daemons can share a machine. No menu library, as for the session menu.

const props = defineProps<{ store: Store }>();

const root = ref<HTMLElement | null>(null);
const open = ref(false);
useDismiss(open, root);
const pairing = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);

const labels = computed(() => daemonLabels(props.store.state.daemons));
const active = computed(() => props.store.state.activeDaemon);
const current = computed(() =>
  active.value === null ? 'No daemon open' : (labels.value.get(active.value) ?? ''),
);
const others = computed(() =>
  props.store.state.daemons
    .filter((d) => d.id !== active.value)
    .map((d) => ({ id: d.id, label: labels.value.get(d.id) ?? '' })),
);

const toggle = (): void => {
  open.value = !open.value;
};
const choose = (id: string): void => {
  open.value = false;
  void props.store.switchDaemon(id);
};
// The picker's button takes the focus first, so the dialog gives it back there on close.
const startPairing = (): void => {
  open.value = false;
  trigger.value?.focus();
  pairing.value = true;
};
</script>

<template>
  <div v-if="store.state.daemons.length > 1" ref="root" class="picker">
    <button
      ref="trigger"
      type="button"
      class="current"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-label="`Daemon: ${current}`"
      :title="`Daemon: ${current}`"
      @click="toggle"
    >
      <span class="name">{{ current }}</span>
      <Icon name="expand" />
    </button>
    <div v-if="open" class="menu" role="menu" aria-label="Daemons">
      <button v-for="d in others" :key="d.id" type="button" role="menuitem" @click="choose(d.id)">
        {{ d.label }}
      </button>
      <button type="button" role="menuitem" class="pair-another" @click="startPairing">
        <Icon name="plus" />Pair another daemon
      </button>
    </div>
  </div>
  <PairDaemonDialog v-if="pairing" :store="store" @close="pairing = false" />
</template>

<style scoped>
.picker {
  position: relative;
  flex: none;
  max-width: 40%;
}

.current {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  max-width: 100%;
  background: transparent;
  color: var(--fg);
  padding: 0.4rem 0.5rem;
  margin-left: 0.3rem;
  font-weight: 600;
}

.name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu {
  position: absolute;
  left: 0;
  top: calc(100% + 0.25rem);
  z-index: 3;
  min-width: 12rem;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 4px 16px rgb(0 0 0 / 40%);
  overflow: hidden;
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
  overflow-wrap: anywhere;
}

.menu button:hover {
  background: var(--panel-2);
}

.pair-another {
  border-top: 1px solid var(--border);
}
</style>
