<script setup lang="ts">
import type { AgentKind, Repo } from '@flux/protocol';
import { computed, onMounted, ref } from 'vue';

import type { Store } from '../store/create-store.ts';

// Start an agent: pick a repo (and an agent, when the box has more than one), name the branch (a
// new one is created from the repo's HEAD, an existing one is checked out), write the first prompt.

const props = defineProps<{ store: Store }>();
const emit = defineEmits<{ created: [session: string] }>();

const repos = ref<Repo[]>([]);
const repo = ref('');
const agents = computed(() => props.store.state.agents);
// The box's default agent (settings, when loaded) if it has it, else the first agent it has;
// followed until the operator picks one, and re-derived when the list changes under them.
const defaultAgent = computed((): AgentKind | null => {
  const preferred = props.store.state.settings?.flux.defaultAgent;
  if (preferred !== undefined && agents.value.includes(preferred)) return preferred;
  return agents.value[0] ?? null;
});
const picked = ref<AgentKind | null>(null);
const agent = computed({
  get: (): AgentKind | null =>
    picked.value !== null && agents.value.includes(picked.value)
      ? picked.value
      : defaultAgent.value,
  set: (value: AgentKind | null) => {
    picked.value = value;
  },
});
const branch = ref(`flux/${new Date().toISOString().slice(0, 10)}`);
const title = ref('');
const prompt = ref('');
const busy = ref(false);
const failure = ref<string | null>(null);

const ready = computed(
  () =>
    repo.value !== '' &&
    branch.value.trim() !== '' &&
    prompt.value.trim() !== '' &&
    agent.value !== null,
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
  const chosen = agent.value;
  if (!ready.value || busy.value || chosen === null) return;
  busy.value = true;
  failure.value = null;
  try {
    const name = title.value.trim();
    const summary = await props.store.createSession({
      repo: repo.value,
      branch: branch.value.trim(),
      agent: chosen,
      ...(name === '' ? {} : { title: name }),
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
});
</script>

<template>
  <form class="new" @submit.prevent="create">
    <h2>New session</h2>
    <label for="new-repo">Repository</label>
    <select id="new-repo" v-model="repo" :disabled="busy">
      <option v-for="r in repos" :key="r.path" :value="r.path">{{ r.name }}</option>
    </select>
    <p v-if="agents.length === 0" class="error">
      No agent found on the box: install claude or pi on it and restart the daemon.
    </p>
    <label v-if="agents.length > 1" for="new-agent">Agent</label>
    <select v-if="agents.length > 1" id="new-agent" v-model="agent" :disabled="busy">
      <option v-for="a in agents" :key="a" :value="a">{{ a }}</option>
    </select>
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
