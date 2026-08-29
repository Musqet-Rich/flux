<script setup lang="ts">
import type { AgentKind, FluxSettings } from '@flux/protocol';
import { computed, ref, watch } from 'vue';

import type { Store } from '../store/create-store.ts';

// The box's runtime settings as a form, and the environment-only values as read-only rows.
// The form is a copy of what the box last sent; Save sends the whole copy back.

const props = defineProps<{ store: Store }>();

const form = ref<FluxSettings | null>(null);
const busy = ref(false);

const stored = computed(() => props.store.state.settings?.flux ?? null);
const env = computed(() => {
  const e = props.store.state.settings?.env;
  return e === undefined
    ? []
    : [
        { name: 'Relay', value: e.relayUrl },
        { name: 'Data directory', value: e.dataDir },
        { name: 'Daemon', value: e.daemonName },
        { name: 'Push subject', value: e.pushSubject },
        { name: 'Claude command', value: e.claudeCommand },
      ];
});

watch(
  stored,
  (next) => {
    form.value = next === null ? null : { ...next };
  },
  { immediate: true },
);

const dirty = computed(
  () => JSON.stringify(form.value) !== JSON.stringify(stored.value) && form.value !== null,
);

const agents: AgentKind[] = ['claude', 'pi'];
const triggers = [
  { field: 'notifyOnAsk', text: 'the agent asks a question' },
  { field: 'notifyOnIdle', text: 'the agent goes idle' },
  { field: 'notifyOnDone', text: 'the agent reports done or blocked' },
] as const;

const save = async (): Promise<void> => {
  if (form.value === null) return;
  busy.value = true;
  await props.store.saveSettings({ flux: { ...form.value } });
  busy.value = false;
};
</script>

<template>
  <form class="flux" @submit.prevent="save">
    <h2>Flux</h2>
    <p v-if="form === null" class="hint">Loading…</p>
    <template v-else>
      <label for="flux-repos">Repositories directory</label>
      <input
        id="flux-repos"
        v-model="form.reposDir"
        type="text"
        autocomplete="off"
        :disabled="busy"
      />
      <label for="flux-agent">Default agent</label>
      <select id="flux-agent" v-model="form.defaultAgent" :disabled="busy">
        <option v-for="a in agents" :key="a" :value="a">{{ a }}</option>
      </select>
      <fieldset class="notify">
        <legend>Notify me when</legend>
        <label v-for="t in triggers" :key="t.field" class="trigger">
          <input v-model="form[t.field]" type="checkbox" :disabled="busy" />
          <span>{{ t.text }}</span>
        </label>
      </fieldset>
      <button type="submit" :disabled="!dirty || busy">
        {{ dirty ? 'Save changes' : 'Saved' }}
      </button>
    </template>
    <dl v-if="env.length > 0" class="env">
      <template v-for="row in env" :key="row.name">
        <dt>{{ row.name }}</dt>
        <dd>{{ row.value }}</dd>
      </template>
    </dl>
    <p v-if="env.length > 0" class="hint">Set in the daemon's environment; change them there.</p>
  </form>
</template>

<style scoped>
.flux {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

h2 {
  font-size: 1rem;
  margin: 0 0 0.25rem;
}

.hint {
  color: var(--muted);
  margin: 0.5rem 0 0;
}

.notify {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin: 0.25rem 0;
}

.trigger {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}

.trigger input {
  width: auto;
}

.env {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.25rem 0.75rem;
  margin: 0.75rem 0 0;
  font-size: 0.85rem;
}

dt {
  color: var(--muted);
}

dd {
  margin: 0;
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
