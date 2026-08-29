<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { Store } from '../store/create-store.ts';

// The agent's global config as two plain text areas: `~/.claude/CLAUDE.md` and
// `~/.claude/settings.json` on the box. The JSON is checked here before it is sent and again
// on the box; only the fields that changed go over the wire.

const props = defineProps<{ store: Store }>();

const claudeMd = ref('');
const settingsJson = ref('');
const busy = ref(false);
const failure = ref<string | null>(null);

const stored = computed(() => props.store.state.settings?.agent ?? null);

// A field follows the box only while it has no unsaved edit: the other section's save
// replaces `settings` too and must not wipe what is being typed here.
watch(
  stored,
  (next, previous) => {
    if (claudeMd.value === (previous?.claudeMd ?? '')) claudeMd.value = next?.claudeMd ?? '';
    if (settingsJson.value === (previous?.settingsJson ?? '')) {
      settingsJson.value = next?.settingsJson ?? '';
    }
  },
  { immediate: true },
);

const mdDirty = computed(() => stored.value !== null && claudeMd.value !== stored.value.claudeMd);
const jsonDirty = computed(
  () => stored.value !== null && settingsJson.value !== stored.value.settingsJson,
);
const dirty = computed(() => mdDirty.value || jsonDirty.value);

// The box refuses anything but a JSON object, an empty file included.
const jsonError = computed((): string | null => {
  if (!jsonDirty.value) return null;
  if (settingsJson.value.trim() === '') return 'settings.json cannot be empty';
  try {
    const parsed: unknown = JSON.parse(settingsJson.value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? null
      : 'settings.json must be a JSON object';
  } catch (error) {
    return error instanceof Error ? error.message : 'not valid JSON';
  }
});

const save = async (): Promise<void> => {
  if (!dirty.value || jsonError.value !== null) return;
  busy.value = true;
  failure.value = null;
  const patch = {
    ...(mdDirty.value ? { claudeMd: claudeMd.value } : {}),
    ...(jsonDirty.value ? { settingsJson: settingsJson.value } : {}),
  };
  const ok = await props.store.saveSettings({ agent: patch });
  if (!ok) failure.value = props.store.state.error;
  busy.value = false;
};
</script>

<template>
  <form class="agent" @submit.prevent="save">
    <h2>Agent config</h2>
    <p v-if="stored === null" class="hint">Loading…</p>
    <template v-else>
      <label for="agent-md">
        CLAUDE.md
        <span v-if="mdDirty" class="dirty">edited</span>
      </label>
      <textarea id="agent-md" v-model="claudeMd" rows="10" spellcheck="false" :disabled="busy" />
      <label for="agent-json">
        settings.json
        <span v-if="jsonDirty" class="dirty">edited</span>
      </label>
      <textarea
        id="agent-json"
        v-model="settingsJson"
        rows="10"
        spellcheck="false"
        :disabled="busy"
        :class="{ invalid: jsonError !== null }"
      />
      <p v-if="jsonError !== null" class="error">{{ jsonError }}</p>
      <button type="submit" :disabled="!dirty || jsonError !== null || busy">
        {{ dirty ? 'Save changes' : 'Saved' }}
      </button>
      <p v-if="failure !== null" class="error">{{ failure }}</p>
    </template>
  </form>
</template>

<style scoped>
.agent {
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
  margin: 0;
}

label {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
}

.dirty {
  color: var(--warn);
  font-size: 0.8rem;
}

textarea {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
  white-space: pre;
}

textarea.invalid {
  border-color: var(--danger);
}

.error {
  color: var(--danger);
  margin: 0;
}
</style>
