<script setup lang="ts">
import type { SessionSummary } from '@flux/protocol';

import Icon from './Icon.vue';
import SessionTabs from './SessionTabs.vue';

// The bar above every screen: the session tabs, then the command runner, help and settings
// buttons. Its own component so Shell keeps its dependency budget; `screen` is the route name,
// so the runner and settings buttons can show which of them is open.

defineProps<{ sessions: SessionSummary[]; active: string | null; screen: string }>();
defineEmits<{ select: [session: string]; create: []; runner: []; help: []; settings: [] }>();
</script>

<template>
  <header class="top">
    <SessionTabs
      :sessions="sessions"
      :active="active"
      @select="$emit('select', $event)"
      @create="$emit('create')"
    />
    <button
      type="button"
      class="gear icon-only"
      :class="{ active: screen === 'runner' }"
      aria-label="Command runner"
      title="Run a command"
      @click="$emit('runner')"
    >
      <Icon name="runner" />
    </button>
    <button
      type="button"
      class="gear icon-only"
      aria-label="Ask about Flux"
      title="Ask about Flux"
      @click="$emit('help')"
    >
      <Icon name="help" />
    </button>
    <button
      type="button"
      class="gear icon-only"
      :class="{ active: screen === 'settings' }"
      aria-label="Settings"
      title="Settings"
      @click="$emit('settings')"
    >
      <Icon name="settings" />
    </button>
  </header>
</template>

<style scoped>
.top {
  flex: none;
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  padding-top: env(safe-area-inset-top);
}

.top > :first-child {
  flex: 1;
  min-width: 0;
}

.gear {
  flex: none;
  background: transparent;
  color: var(--muted);
  font-size: 1.2rem;
  line-height: 1;
  padding: 0.4rem 0.5rem;
  margin-right: 0.3rem;
}

.gear.active {
  color: var(--fg);
}
</style>
