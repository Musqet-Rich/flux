<script setup lang="ts">
import type { HarnessKind, Repo } from '@flux/protocol';
import { computed, onMounted, ref } from 'vue';

import type { Store } from '../store/create-store.ts';

// Start an agent: pick a repo (and a harness, when the box has more than one), an optional model
// and effort, name the branch (a new one is created from the repo's HEAD, an existing one is
// checked out), write the first prompt.

const props = defineProps<{ store: Store }>();
const emit = defineEmits<{ created: [session: string] }>();

// Free-text model and effort with these as hints (ADR 0023 § 6): the vocabularies move every
// release, so a launch never forces a PWA release. Empty means unset (the box's own default).
const modelHints = ['opus', 'sonnet', 'fable'];
const effortHints = ['low', 'medium', 'high', 'xhigh', 'max'];

const repos = ref<Repo[]>([]);
const repo = ref('');
const harnesses = computed(() => props.store.state.agents);
// The box's default harness (settings, when loaded) if it has it, else the first harness it has;
// followed until the operator picks one, and re-derived when the list changes under them.
const defaultHarness = computed((): HarnessKind | null => {
  const preferred = props.store.state.settings?.flux.defaultHarness;
  if (preferred !== undefined && harnesses.value.includes(preferred)) return preferred;
  return harnesses.value[0] ?? null;
});
const picked = ref<HarnessKind | null>(null);
const harness = computed({
  get: (): HarnessKind | null =>
    picked.value !== null && harnesses.value.includes(picked.value)
      ? picked.value
      : defaultHarness.value,
  set: (value: HarnessKind | null) => {
    picked.value = value;
  },
});
// Saved Agents (ADR 0023 § 2): picking one seeds the model/effort inputs and sends its name on
// create, so the box resolves model/effort/role from it; the operator can still override the
// seeded values (inline values win). "None" is today's bare-harness behaviour.
const agents = computed(() => props.store.state.settings?.agents ?? []);
const agentName = ref('');
const branch = ref(`flux/${new Date().toISOString().slice(0, 10)}`);
const title = ref('');
const model = ref('');
const effort = ref('');
const prompt = ref('');
const busy = ref(false);
const failure = ref<string | null>(null);

const harnessLabel = (kind: HarnessKind): string => (kind === 'claude' ? 'Claude Code' : 'Pi');

// Selecting a saved Agent seeds Model and Effort from it; None leaves the inputs alone.
const agentPick = computed({
  get: (): string => agentName.value,
  set: (name: string) => {
    agentName.value = name;
    const chosen = agents.value.find((a) => a.name === name);
    if (chosen === undefined) return;
    model.value = chosen.model ?? '';
    effort.value = chosen.effort ?? '';
  },
});

const ready = computed(
  () =>
    repo.value !== '' &&
    branch.value.trim() !== '' &&
    prompt.value.trim() !== '' &&
    harness.value !== null,
);

const loadRepos = async (): Promise<void> => {
  try {
    const result = await props.store.call('repos.list', {});
    repos.value = result.repos;
    repo.value = result.repos[0]?.path ?? '';
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error);
  }
};

const create = async (): Promise<void> => {
  const chosen = harness.value;
  if (!ready.value || busy.value || chosen === null) return;
  busy.value = true;
  failure.value = null;
  try {
    const name = title.value.trim();
    const wantModel = model.value.trim();
    const wantEffort = effort.value.trim();
    const summary = await props.store.createSession({
      repo: repo.value,
      branch: branch.value.trim(),
      harness: chosen,
      ...(name === '' ? {} : { title: name }),
      ...(agentName.value === '' ? {} : { agent: agentName.value }),
      ...(wantModel === '' ? {} : { model: wantModel }),
      ...(wantEffort === '' ? {} : { effort: wantEffort }),
    });
    await props.store.open(summary.session);
    await props.store.send(summary.session, prompt.value.trim());
    emit('created', summary.session);
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
};

onMounted(() => {
  void loadRepos();
  // Load saved Agents for the picker; the box may not have been asked for settings yet.
  void props.store.refreshSettings();
});
</script>

<template>
  <form class="new" @submit.prevent="create">
    <h2>New session</h2>
    <label for="new-repo">Repository</label>
    <select id="new-repo" v-model="repo" :disabled="busy">
      <option v-for="r in repos" :key="r.path" :value="r.path">{{ r.name }}</option>
    </select>
    <p v-if="harnesses.length === 0" class="error">
      No harness found on the box: install claude or pi on it and restart the daemon.
    </p>
    <label v-if="harnesses.length > 1" for="new-harness">Harness</label>
    <select v-if="harnesses.length > 1" id="new-harness" v-model="harness" :disabled="busy">
      <option v-for="h in harnesses" :key="h" :value="h">{{ harnessLabel(h) }}</option>
    </select>
    <label v-if="agents.length > 0" for="new-agent">Agent (optional)</label>
    <select v-if="agents.length > 0" id="new-agent" v-model="agentPick" :disabled="busy">
      <option value="">None</option>
      <option v-for="a in agents" :key="a.name" :value="a.name">{{ a.name }}</option>
    </select>
    <label for="new-model">Model (optional)</label>
    <input
      id="new-model"
      v-model="model"
      type="text"
      list="new-model-hints"
      autocomplete="off"
      placeholder="box default"
      :disabled="busy"
    />
    <datalist id="new-model-hints">
      <option v-for="m in modelHints" :key="m" :value="m" />
    </datalist>
    <label for="new-effort">Effort (optional)</label>
    <input
      id="new-effort"
      v-model="effort"
      type="text"
      list="new-effort-hints"
      autocomplete="off"
      placeholder="box default"
      :disabled="busy"
    />
    <datalist id="new-effort-hints">
      <option v-for="e in effortHints" :key="e" :value="e" />
    </datalist>
    <label for="new-branch">Branch</label>
    <input id="new-branch" v-model="branch" type="text" autocomplete="off" :disabled="busy" />
    <label for="new-title">Title (optional)</label>
    <input id="new-title" v-model="title" type="text" autocomplete="off" :disabled="busy" />
    <label for="new-prompt">First message</label>
    <textarea id="new-prompt" v-model="prompt" rows="6" :disabled="busy" />
    <button type="submit" :disabled="!ready || busy">Start agent</button>
    <p v-if="failure !== null" class="error">{{ failure }}</p>
  </form>
</template>

<style scoped>
.new {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 1rem;
  max-width: 32rem;
  width: 100%;
  box-sizing: border-box;
  margin: 0 auto;
  overflow-y: auto;
}

h2 {
  margin: 0 0 0.5rem;
  font-size: 1.2rem;
}

label {
  color: var(--muted);
  font-size: 0.85rem;
  margin-top: 0.4rem;
}

button {
  margin-top: 0.8rem;
}

.error {
  color: var(--danger);
  margin: 0;
}
</style>
