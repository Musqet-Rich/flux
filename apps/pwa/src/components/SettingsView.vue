<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import type { Store } from '../store/create-store.ts';
import Icon from './Icon.vue';
import { settingsIndex } from './settings-index.ts';
import SettingsSections from './SettingsSections.vue';

// The settings screen (prd.md P2): the toolbar with its search box, and the sections
// (SettingsSections). Each section talks to the store on its own; this only fetches on open.
//
// The search filters the screen through `settings-index.ts`: a field or section is shown while
// its id is in `visible`, everything while the box is blank. The query is this screen's alone,
// gone when it closes.

const props = defineProps<{ store: Store }>();
defineEmits<{ back: [] }>();

const query = ref('');
const trimmed = computed(() => query.value.trim());
const visible = computed(() => settingsIndex.search(trimmed.value));

const clear = (): void => {
  query.value = '';
};

onMounted(() => {
  void props.store.refreshDevices();
  void props.store.refreshSettings();
});
</script>

<template>
  <section class="settings">
    <div class="toolbar">
      <button
        type="button"
        class="secondary icon-only"
        aria-label="Back to sessions"
        title="Back to sessions"
        @click="$emit('back')"
      >
        <Icon name="back" />
      </button>
      <h1>Settings</h1>
      <input
        v-model="query"
        type="search"
        class="search"
        aria-label="Search settings"
        placeholder="Search settings"
        autocomplete="off"
        spellcheck="false"
        @keydown.esc="clear"
      />
    </div>
    <SettingsSections :store="store" :visible="visible" :query="trimmed" />
  </section>
</template>

<style scoped>
.settings {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.toolbar {
  flex: none;
  display: flex;
  gap: 0.75rem;
  align-items: center;
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--border);
}

h1 {
  font-size: 1.1rem;
  margin: 0;
}

/* The search takes the toolbar's remaining width: on a phone that is most of it. Without
   `appearance: none` iOS Safari draws its own search field and ignores the app's border. */
.search {
  flex: 1;
  min-width: 0;
  padding: 0.35rem 0.6rem;
  appearance: none;
  -webkit-appearance: none;
}
</style>
