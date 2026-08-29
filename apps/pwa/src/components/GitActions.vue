<script setup lang="ts">
import type { Commit } from '@flux/protocol';
import { computed, onMounted, ref } from 'vue';

import type { Store } from '../store/create-store.ts';

// Commit, push and open a PR from the changes screen (prd.md § P2). One action at a time; a
// failure shows here and in the status bar; `done` tells the parent to refresh the file list.

const props = defineProps<{ store: Store; session: string; selected: string[] }>();
const emit = defineEmits<{ done: [] }>();

type Action = 'commit' | 'push' | 'pr';

const message = ref('');
const chosenTitle = ref<string | null>(null);
const body = ref('');
const draft = ref(false);
const busy = ref<Action | null>(null);
const failure = ref<string | null>(null);
const prUrl = ref<string | null>(null);
const last = ref<Commit | null>(null);

const summary = computed(() => props.store.state.sessions.find((s) => s.session === props.session));
// The PR title starts as the session title and becomes whatever the operator types.
const title = computed({
  get: () => chosenTitle.value ?? summary.value?.title ?? '',
  set: (value: string) => {
    chosenTitle.value = value;
  },
});
const idle = computed(() => busy.value === null);
const canCommit = computed(() => idle.value && message.value.trim() !== '');
const canPr = computed(() => idle.value && title.value.trim() !== '');
const commitLabel = computed(() =>
  props.selected.length === 0 ? 'Commit all' : `Commit ${props.selected.length} selected`,
);
const lastLine = computed(() =>
  last.value === null ? '' : `${last.value.sha.slice(0, 7)} ${last.value.subject}`,
);

const loadLog = async (): Promise<void> => {
  try {
    const result = await props.store.call('git.log', { session: props.session, limit: 1 });
    last.value = result.commits[0] ?? null;
  } catch {
    // No log yet (or offline); the status bar reports connection trouble.
  }
};

const run = async (action: Action, act: () => Promise<boolean>): Promise<void> => {
  if (busy.value !== null) return;
  busy.value = action;
  failure.value = null;
  const ok = await act();
  if (!ok) failure.value = props.store.state.error ?? `${action} failed`;
  busy.value = null;
};

const commit = (): Promise<void> =>
  run('commit', async () => {
    const paths = props.selected.length === 0 ? undefined : [...props.selected];
    const sha = await props.store.commit(props.session, message.value.trim(), paths);
    if (sha === null) return false;
    message.value = '';
    await loadLog();
    emit('done');
    return true;
  });

const push = (): Promise<void> =>
  run('push', async () => {
    const pushed = await props.store.push(props.session);
    if (pushed === null) return false;
    await loadLog();
    emit('done');
    return true;
  });

const openPr = (): Promise<void> =>
  run('pr', async () => {
    const text = body.value.trim();
    const url = await props.store.openPr(props.session, {
      title: title.value.trim(),
      ...(text === '' ? {} : { body: text }),
      ...(draft.value ? { draft: true } : {}),
    });
    if (url === null) return false;
    prUrl.value = url;
    return true;
  });

onMounted(() => {
  void loadLog();
});
</script>

<template>
  <section class="actions">
    <p v-if="last !== null" class="last">{{ lastLine }}</p>
    <textarea
      id="commit-message"
      v-model="message"
      rows="2"
      placeholder="Commit message"
      :disabled="!idle"
    />
    <div class="row">
      <button type="button" class="commit" :disabled="!canCommit" @click="commit">
        {{ commitLabel }}
      </button>
      <button type="button" class="push secondary" :disabled="!idle" @click="push">Push</button>
    </div>
    <details class="pr">
      <summary>Open PR</summary>
      <input
        id="pr-title"
        v-model="title"
        type="text"
        autocomplete="off"
        placeholder="Title"
        :disabled="!idle"
      />
      <textarea
        id="pr-body"
        v-model="body"
        rows="3"
        placeholder="Body (optional)"
        :disabled="!idle"
      />
      <div class="row">
        <label class="draft"
          ><input v-model="draft" type="checkbox" :disabled="!idle" /> Draft</label
        >
        <button type="button" class="open-pr" :disabled="!canPr" @click="openPr">Open PR</button>
      </div>
      <p v-if="prUrl !== null" class="url">
        <a :href="prUrl" target="_blank" rel="noopener">{{ prUrl }}</a>
      </p>
    </details>
    <p v-if="failure !== null" class="error">{{ failure }}</p>
  </section>
</template>

<style scoped>
.actions {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  border-top: 1px solid var(--border);
  background: var(--panel);
}

.last {
  margin: 0;
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
  overflow-wrap: anywhere;
}

.row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.row .commit {
  flex: 1;
}

.pr {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.pr summary {
  cursor: pointer;
  color: var(--muted);
}

.draft {
  flex: 1;
  display: flex;
  gap: 0.4rem;
  align-items: center;
}

.draft input {
  width: auto;
}

.url {
  margin: 0;
  overflow-wrap: anywhere;
}

.url a {
  color: var(--accent);
}

.error {
  margin: 0;
  color: var(--danger);
}
</style>
