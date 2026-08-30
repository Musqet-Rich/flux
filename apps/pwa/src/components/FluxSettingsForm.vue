<script setup lang="ts">
import type { AgentKind, FluxSettings } from '@flux/protocol';
import { semver } from '@flux/protocol';
import { computed, ref, watch } from 'vue';

import type { Store } from '../store/create-store.ts';
import { version as appVersion } from '../version.ts';

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

// Read-only version rows (ADR 0021): this app's own build version, and the daemon's from `hello`
// (`unknown` for a daemon built before it sent one).
const versions = computed(() => [
  { name: 'Daemon version', value: props.store.state.daemonVersion ?? 'unknown' },
  { name: 'App version', value: appVersion },
]);

// Self-update (ADR 0022). An update is on offer when the box reports a version older than this
// app's; the button installs the app's own version. While installing, `update` follows the
// progress ephemerals; on success the reconnect clears it and the offer goes away.
const update = computed(() => props.store.state.update);
const updateAvailable = computed(() => {
  const daemonVersion = props.store.state.daemonVersion;
  return daemonVersion !== null && semver.isNewer(appVersion, daemonVersion);
});
const showUpdate = computed(() => updateAvailable.value || update.value.target !== null);
const phaseLabel = computed(() => update.value.phase ?? 'starting');
const startUpdate = async (): Promise<void> => {
  await props.store.updateDaemon(appVersion);
};

const fields = ['reposDir', 'defaultAgent', 'notifyOnAsk', 'notifyOnIdle', 'notifyOnDone'] as const;

// A field follows the box only while it has no unsaved edit (see AgentConfigEditor).
watch(
  stored,
  (next, previous) => {
    if (next === null) {
      form.value = null;
      return;
    }
    const current = form.value;
    if (current === null || previous === null || previous === undefined) {
      form.value = { ...next };
      return;
    }
    for (const field of fields) {
      if (current[field] === previous[field]) Object.assign(current, { [field]: next[field] });
    }
  },
  { immediate: true },
);

const changed = computed((): Partial<FluxSettings> => {
  const current = form.value;
  const base = stored.value;
  if (current === null || base === null) return {};
  return Object.fromEntries(
    fields.filter((field) => current[field] !== base[field]).map((f) => [f, current[f]]),
  );
});
const dirty = computed(() => Object.keys(changed.value).length > 0);

// Only agents the box found (`hello.agents`); the box refuses the others.
const agents = computed((): AgentKind[] => props.store.state.agents);
const triggers = [
  { field: 'notifyOnAsk', text: 'the agent asks a question' },
  { field: 'notifyOnIdle', text: 'the agent goes idle' },
  { field: 'notifyOnDone', text: 'the agent reports done or blocked' },
] as const;

const save = async (): Promise<void> => {
  if (form.value === null) return;
  busy.value = true;
  await props.store.saveSettings({ flux: changed.value });
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
    <dl class="versions">
      <template v-for="row in versions" :key="row.name">
        <dt>{{ row.name }}</dt>
        <dd>{{ row.value }}</dd>
      </template>
    </dl>
    <div v-if="showUpdate" class="update">
      <button v-if="update.target === null" type="button" class="update-btn" @click="startUpdate">
        Update daemon to {{ appVersion }}
      </button>
      <template v-else>
        <p v-if="update.failed !== null" class="update-error">Update failed: {{ update.failed }}</p>
        <p v-else class="hint">Updating to {{ update.target }}… {{ phaseLabel }}</p>
        <button v-if="update.failed !== null" type="button" class="secondary" @click="startUpdate">
          Retry
        </button>
      </template>
    </div>
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

.env,
.versions {
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

.update {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin: 0.75rem 0 0;
}

.update-error {
  color: var(--danger);
  margin: 0;
}
</style>
