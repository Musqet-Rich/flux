<script setup lang="ts">
import type { Attachment } from '@flux/protocol';
import { ref } from 'vue';

import { formatBytes } from './format-bytes.ts';

// The files under a sent message (ADR 0020): a thumbnail where the store has fetched one,
// otherwise the name and size. Tapping a thumbnail opens the image full-size in a plain
// overlay; there is no download yet.

defineProps<{ attachments: Attachment[]; thumbs: Record<string, string> }>();
const open = ref<string | null>(null);
</script>

<template>
  <ul class="files" aria-label="Attached files">
    <li v-for="a in attachments" :key="a.id" class="file">
      <button
        v-if="thumbs[a.id] !== undefined"
        type="button"
        class="image"
        :aria-label="`Open ${a.name}`"
        @click="open = thumbs[a.id] ?? null"
      >
        <img :src="thumbs[a.id]" :alt="a.name" />
      </button>
      <span v-else class="plain">
        <span class="icon" aria-hidden="true">📄</span>
        <span class="name">{{ a.name }}</span>
        <span class="size">{{ formatBytes(a.size) }}</span>
      </span>
    </li>
  </ul>
  <div v-if="open !== null" class="overlay" role="dialog" aria-label="Image" @click="open = null">
    <img :src="open" alt="" />
    <button type="button" class="secondary close" aria-label="Close" @click.stop="open = null">
      ×
    </button>
  </div>
</template>

<style scoped>
.files {
  list-style: none;
  margin: 0.4rem 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.image {
  padding: 0;
  background: transparent;
  border-radius: 6px;
  overflow: hidden;
  line-height: 0;
}

.image img {
  max-width: 12rem;
  max-height: 12rem;
  display: block;
}

.plain {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.5rem;
  border-radius: var(--radius);
  background: rgb(0 0 0 / 15%);
  font-size: 0.8rem;
}

.size {
  opacity: 0.7;
}

.overlay {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 85%);
}

.overlay img {
  max-width: 100vw;
  max-height: 100vh;
  object-fit: contain;
}

.close {
  position: absolute;
  top: calc(0.5rem + env(safe-area-inset-top));
  right: 0.5rem;
  font-size: 1.2rem;
  line-height: 1;
}
</style>
