<script setup lang="ts">
import type { FluxSettings, HarnessKind } from '@flux/protocol';
import { computed, onMounted, ref, watch } from 'vue';

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

// Self-update (ADR 0021/0022). On open the box runs `daemon.checkUpdate`: it discovers the newest
// published release and dry-run verifies it WITHOUT applying. The button installs that release,
// and is offered ONLY when the box found a newer, floor-satisfying release AND its own verify
// passed — a release that failed verify is shown but never installable, and a box that could not
// check (offline, no release, or a daemon too old to have the method) degrades to a quiet notice.
// While installing, `update` follows the progress ephemerals; on success the reconnect clears it.
const update = computed(() => props.store.state.update);
const inProgress = computed(() => update.value.target !== null);
const phaseLabel = computed(() => update.value.phase ?? 'starting');

// A flat view so the template narrows on `kind` alone and never reaches into a union member.
interface CheckView {
  kind: 'unavailable' | 'up-to-date' | 'available';
  label: string;
  version: string;
  verified: boolean;
}

const availableLabel = (version: string, verified: boolean, reason: string | undefined): string =>
  verified
    ? `Update available: ${version} — verified ✓`
    : `Update available: ${version} — cannot verify (${reason ?? 'unknown'})`;

const checkView = computed((): CheckView | null => {
  const c = props.store.state.updateCheck;
  if (c === null) return null;
  if (c.latest === null) return { kind: 'unavailable', label: '', version: '', verified: false };
  if (c.available) {
    const verified = c.verified === true;
    return {
      kind: 'available',
      label: availableLabel(c.latest, verified, c.reason),
      version: c.latest,
      verified,
    };
  }
  return {
    kind: 'up-to-date',
    label: `Up to date (${c.current})`,
    version: c.latest,
    verified: false,
  };
});
const showUpdate = computed(() => inProgress.value || checkView.value !== null);

// Only ever install a release the box found AND verified itself: the button is already disabled
// otherwise, and this guard makes that non-bypassable (security: never apply an unverified target).
const startUpdate = async (): Promise<void> => {
  const c = props.store.state.updateCheck;
  if (c === null || c.latest === null || !c.available || c.verified !== true) return;
  await props.store.updateDaemon(c.latest);
};
const retryUpdate = async (): Promise<void> => {
  const target = update.value.target;
  if (target === null) return;
  await props.store.updateDaemon(target);
};

onMounted(() => {
  void props.store.checkUpdate();
});

const fields = [
  'reposDir',
  'defaultHarness',
  'notifyOnAsk',
  'notifyOnIdle',
  'notifyOnDone',
] as const;

// A field follows the box only while it has no unsaved edit (see HarnessConfigEditor).
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

// Only harnesses the box found (`hello.agents`); the box refuses the others.
const harnesses = computed((): HarnessKind[] => props.store.state.agents);
const harnessLabel = (kind: HarnessKind): string =>
  kind === 'claude' ? 'Claude Code' : kind === 'pi' ? 'Pi' : 'opencode';
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
      <label for="flux-harness">Default harness</label>
      <select id="flux-harness" v-model="form.defaultHarness" :disabled="busy">
        <option v-for="h in harnesses" :key="h" :value="h">{{ harnessLabel(h) }}</option>
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
      <template v-if="inProgress">
        <p v-if="update.failed !== null" class="update-error">Update failed: {{ update.failed }}</p>
        <p v-else class="hint">Updating to {{ update.target }}… {{ phaseLabel }}</p>
        <button v-if="update.failed !== null" type="button" class="secondary" @click="retryUpdate">
          Retry
        </button>
      </template>
      <template v-else-if="checkView !== null">
        <p v-if="checkView.kind === 'unavailable'" class="hint update-unavailable">
          Couldn't check for updates.
        </p>
        <p v-else-if="checkView.kind === 'up-to-date'" class="hint update-current">
          {{ checkView.label }}
        </p>
        <template v-else>
          <p class="update-status">{{ checkView.label }}</p>
          <button
            type="button"
            class="update-btn"
            :disabled="!checkView.verified"
            @click="startUpdate"
          >
            Update to {{ checkView.version }}
          </button>
        </template>
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

.update-status {
  margin: 0;
}
</style>
