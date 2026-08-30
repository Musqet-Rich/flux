<script setup lang="ts">
import type { Skill } from '@flux/protocol';
import { skillName } from '@flux/protocol';
import { computed, onMounted, ref, watch } from 'vue';

import type { Store } from '../store/create-store.ts';

// Box-side skills as an editable list (protocol.md § 7 `skills.*`): each a name and a `SKILL.md`
// body under the flux user's `~/.claude/skills`. Each row saves and deletes on its own through
// `skills.write`/`skills.delete`; the name of a saved skill is locked, since a rename would leave
// the old one behind. A daemon too old to have the methods leaves `state.skills` empty, so this
// shows the "no skills" hint and every save quietly no-ops via the store.

interface Row {
  id: number;
  name: string;
  body: string;
  // The name the skill is stored under, or null for a row not yet saved.
  savedName: string | null;
}

const props = defineProps<{ store: Store }>();

let nextId = 0;
const rows = ref<Row[]>([]);
const busy = ref<number | null>(null);
const failure = ref<string | null>(null);

const stored = computed<Skill[] | null>(() => props.store.state.skills);

const toRow = (s: Skill): Row => ({
  id: (nextId += 1),
  name: s.name,
  body: s.body,
  savedName: s.name,
});

// Seed the rows once, when the box's list first arrives. After that the editor owns its rows and
// each save updates `state.skills` on its own, so an in-progress edit in another row is never
// wiped by a re-list (per-row saves, unlike AgentsEditor's whole-list save).
watch(
  stored,
  (next, previous) => {
    if (next !== null && (previous === undefined || previous === null)) {
      rows.value = next.map((s) => toRow(s));
    }
  },
  { immediate: true },
);

onMounted(() => {
  void props.store.refreshSkills();
});

const names = computed(() => rows.value.map((r) => r.name.trim()));
const storedBody = (name: string): string | null =>
  stored.value?.find((s) => s.name === name)?.body ?? null;

const nameError = (row: Row): string | null => {
  const name = row.name.trim();
  if (name === '') return 'A skill needs a name.';
  if (!skillName.is(name)) return 'No slashes, dots-only or control characters in a name.';
  if (names.value.filter((n) => n === name).length > 1) return 'Skill names must be unique.';
  return null;
};

const dirty = (row: Row): boolean =>
  nameError(row) === null && storedBody(row.name.trim()) !== row.body;

const add = (): void => {
  rows.value.push({ id: (nextId += 1), name: '', body: '', savedName: null });
};

const save = async (row: Row): Promise<void> => {
  if (!dirty(row) || busy.value !== null) return;
  busy.value = row.id;
  failure.value = null;
  const name = row.name.trim();
  const ok = await props.store.saveSkill(name, row.body);
  if (ok) row.savedName = name;
  else failure.value = props.store.state.error?.message ?? null;
  busy.value = null;
};

const remove = async (row: Row): Promise<void> => {
  if (busy.value !== null) return;
  if (row.savedName === null) {
    rows.value = rows.value.filter((r) => r.id !== row.id);
    return;
  }
  busy.value = row.id;
  failure.value = null;
  const ok = await props.store.deleteSkill(row.savedName);
  if (ok) rows.value = rows.value.filter((r) => r.id !== row.id);
  else failure.value = props.store.state.error?.message ?? null;
  busy.value = null;
};
</script>

<template>
  <section class="skills-editor">
    <h2>Skills</h2>
    <p v-if="stored === null" class="hint">Loading…</p>
    <template v-else>
      <p v-if="rows.length === 0" class="hint">
        No skills. Add one to give the agent a reusable instruction file it can run as a slash
        command.
      </p>
      <ul class="skill-list">
        <li v-for="row in rows" :key="row.id" class="skill-row">
          <label>
            Name
            <input
              v-model="row.name"
              type="text"
              class="skill-name"
              autocomplete="off"
              spellcheck="false"
              :disabled="busy !== null || row.savedName !== null"
            />
          </label>
          <label>
            SKILL.md
            <textarea
              v-model="row.body"
              class="skill-body"
              rows="6"
              spellcheck="false"
              :disabled="busy !== null"
            />
          </label>
          <p v-if="nameError(row) !== null" class="skill-error">{{ nameError(row) }}</p>
          <div class="skill-actions">
            <button
              type="button"
              class="skill-save"
              :disabled="!dirty(row) || busy !== null"
              @click="save(row)"
            >
              {{ dirty(row) ? 'Save' : 'Saved' }}
            </button>
            <button
              type="button"
              class="secondary skill-delete"
              :disabled="busy !== null"
              @click="remove(row)"
            >
              Delete
            </button>
          </div>
        </li>
      </ul>
      <button type="button" class="secondary skill-add" :disabled="busy !== null" @click="add">
        Add skill
      </button>
      <p v-if="failure !== null" class="error">{{ failure }}</p>
    </template>
  </section>
</template>

<style scoped>
.skills-editor {
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

.skill-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.skill-row {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  color: var(--muted);
  font-size: 0.85rem;
}

.skill-body {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.skill-actions {
  display: flex;
  gap: 0.5rem;
}

.skill-error {
  color: var(--warn);
  margin: 0;
}

.error {
  color: var(--danger);
  margin: 0;
}
</style>
