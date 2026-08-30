<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { Store } from '../store/create-store.ts';

// The harness's global config as two plain text areas: `~/.claude/CLAUDE.md` and
// `~/.claude/settings.json` on the box (ADR 0023 § 1). The JSON is checked here before it is sent
// and again on the box; only the fields that changed go over the wire.

const props = defineProps<{ store: Store }>();

const claudeMd = ref('');
const settingsJson = ref('');
const busy = ref(false);
const failure = ref<string | null>(null);

const stored = computed(() => props.store.state.settings?.harnessConfig ?? null);

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
  const ok = await props.store.saveSettings({ harnessConfig: patch });
  if (!ok) failure.value = props.store.state.error?.message ?? null;
  busy.value = false;
};
</script>

<template>
  <form class="harness-config" @submit.prevent="save">
    <h2>Harness config</h2>
    <p v-if="stored === null" class="hint">Loading…</p>
    <template v-else>
      <div class="editors">
        <div class="editor">
          <label for="harness-md">
            CLAUDE.md
            <span v-if="mdDirty" class="dirty">edited</span>
          </label>
          <textarea
            id="harness-md"
            v-model="claudeMd"
            rows="10"
            spellcheck="false"
            :disabled="busy"
          />
        </div>
        <div class="editor">
          <label for="harness-json">
            settings.json
            <span v-if="jsonDirty" class="dirty">edited</span>
          </label>
          <textarea
            id="harness-json"
            v-model="settingsJson"
            rows="10"
            spellcheck="false"
            :disabled="busy"
            :class="{ invalid: jsonError !== null }"
          />
          <p v-if="jsonError !== null" class="error">{{ jsonError }}</p>
        </div>
      </div>
      <button type="submit" :disabled="!dirty || jsonError !== null || busy">
        {{ dirty ? 'Save changes' : 'Saved' }}
      </button>
      <p v-if="failure !== null" class="error">{{ failure }}</p>
    </template>
  </form>
</template>

<style scoped>
.harness-config {
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

.editors {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.editor {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

/* Wide screens: edit both files side by side, each filling the column height. */
@media (min-width: 56rem) {
  .editors {
    flex-direction: row;
    align-items: stretch;
  }

  .editor {
    flex: 1;
    min-width: 0;
  }

  .editor textarea {
    flex: 1;
  }
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
  /* Wrap long lines to the box width rather than scrolling off-screen; `anywhere` breaks
     unbroken tokens (paths, URLs) too so they never force a horizontal scrollbar. */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

textarea.invalid {
  border-color: var(--danger);
}

.error {
  color: var(--danger);
  margin: 0;
}
</style>
