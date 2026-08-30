<script setup lang="ts">
import type { AgentSpec, HarnessKind } from '@flux/protocol';
import { computed, ref, watch } from 'vue';

import type { Store } from '../store/create-store.ts';

// Saved Agents as an editable list (ADR 0023 § 2): each a name, an optional harness, free-text
// model and effort, and a role. Save sends the whole list through `settings.set`. Blank and
// duplicate names are caught here before the box also rejects them. No tools field (a later step).

interface Row {
  id: number;
  name: string;
  harness: '' | HarnessKind;
  model: string;
  effort: string;
  role: string;
}

const props = defineProps<{ store: Store }>();

let nextId = 0;
const rows = ref<Row[]>([]);
const busy = ref(false);
const failure = ref<string | null>(null);

const stored = computed<AgentSpec[] | null>(() => props.store.state.settings?.agents ?? null);

const toRow = (a: AgentSpec): Row => ({
  id: (nextId += 1),
  name: a.name,
  harness: a.harness ?? '',
  model: a.model ?? '',
  effort: a.effort ?? '',
  role: a.role ?? '',
});

const clean = (row: Row): AgentSpec => ({
  name: row.name.trim(),
  ...(row.harness === '' ? {} : { harness: row.harness }),
  ...(row.model.trim() === '' ? {} : { model: row.model.trim() }),
  ...(row.effort.trim() === '' ? {} : { effort: row.effort.trim() }),
  ...(row.role.trim() === '' ? {} : { role: row.role.trim() }),
});

const cleaned = computed((): AgentSpec[] => rows.value.map((r) => clean(r)));
const dirty = computed(
  () => stored.value !== null && JSON.stringify(cleaned.value) !== JSON.stringify(stored.value),
);

// Follow the box only while nothing is being edited: reseed when the current rows still match
// what the box last sent, so another section's save does not wipe a half-typed list (like
// HarnessConfigEditor). On the first load `previous` is undefined, so seed unconditionally.
watch(
  stored,
  (next, previous) => {
    if (next === null) return;
    const untouched =
      previous === undefined ||
      previous === null ||
      JSON.stringify(cleaned.value) === JSON.stringify(previous);
    if (untouched) rows.value = next.map((a) => toRow(a));
  },
  { immediate: true },
);

const names = computed(() => rows.value.map((r) => r.name.trim()));
const notice = computed((): string | null => {
  if (names.value.some((n) => n === '')) return 'Every agent needs a name.';
  if (new Set(names.value).size !== names.value.length) return 'Agent names must be unique.';
  return null;
});

const harnessLabel = (kind: HarnessKind): string => (kind === 'claude' ? 'Claude Code' : 'Pi');
const harnesses: HarnessKind[] = ['claude', 'pi'];

const add = (): void => {
  rows.value.push(toRow({ name: '' }));
};
const remove = (id: number): void => {
  rows.value = rows.value.filter((r) => r.id !== id);
};

const save = async (): Promise<void> => {
  if (!dirty.value || notice.value !== null) return;
  busy.value = true;
  failure.value = null;
  const ok = await props.store.saveSettings({ agents: cleaned.value });
  if (!ok) failure.value = props.store.state.error?.message ?? null;
  busy.value = false;
};
</script>

<template>
  <form class="agents-editor" @submit.prevent="save">
    <h2>Agents</h2>
    <p v-if="stored === null" class="hint">Loading…</p>
    <template v-else>
      <p v-if="rows.length === 0" class="hint">
        No saved agents. Add one to pick a model, effort and role at session create.
      </p>
      <ul class="agent-list">
        <li v-for="row in rows" :key="row.id" class="agent-row">
          <div class="agent-fields">
            <label>
              Name
              <input
                v-model="row.name"
                type="text"
                class="agent-name"
                autocomplete="off"
                :disabled="busy"
              />
            </label>
            <label>
              Harness
              <select v-model="row.harness" class="agent-harness" :disabled="busy">
                <option value="">Any</option>
                <option v-for="h in harnesses" :key="h" :value="h">{{ harnessLabel(h) }}</option>
              </select>
            </label>
            <label>
              Model
              <input
                v-model="row.model"
                type="text"
                class="agent-model"
                autocomplete="off"
                placeholder="box default"
                :disabled="busy"
              />
            </label>
            <label>
              Effort
              <input
                v-model="row.effort"
                type="text"
                class="agent-effort"
                autocomplete="off"
                placeholder="box default"
                :disabled="busy"
              />
            </label>
          </div>
          <label class="role-label">
            Role
            <textarea v-model="row.role" class="agent-role" rows="3" :disabled="busy" />
          </label>
          <button
            type="button"
            class="secondary agent-delete"
            :disabled="busy"
            @click="remove(row.id)"
          >
            Delete
          </button>
        </li>
      </ul>
      <button type="button" class="secondary agent-add" :disabled="busy" @click="add">
        Add agent
      </button>
      <p v-if="notice !== null" class="notice">{{ notice }}</p>
      <button type="submit" :disabled="!dirty || notice !== null || busy">
        {{ dirty ? 'Save changes' : 'Saved' }}
      </button>
      <p v-if="failure !== null" class="error">{{ failure }}</p>
    </template>
  </form>
</template>

<style scoped>
.agents-editor {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

h2 {
  font-size: 1rem;
  margin: 0 0 0.25rem;
}

.hint {
  color: var(--muted);
  margin: 0;
}

.agent-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.agent-row {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.agent-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}

label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  color: var(--muted);
  font-size: 0.85rem;
}

.agent-role {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.agent-delete {
  align-self: flex-start;
}

.notice {
  color: var(--warn);
  margin: 0;
}

.error {
  color: var(--danger);
  margin: 0;
}
</style>
