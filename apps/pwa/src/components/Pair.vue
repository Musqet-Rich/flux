<script setup lang="ts">
import { pairing } from '@flux/protocol';
import { computed, ref } from 'vue';

import { useScanner } from '../composables/useScanner.ts';
import { requestPushPermission } from '../push/request-push-permission.ts';
import type { StorePhase } from '../store/store-state.ts';

// The connect affordance: scan the QR that `flux pair` prints, or paste the link it encodes.
// Standalone it heads its own screen (`h1`); the homepage embeds it as a section (`h2`).

const props = withDefaults(
  defineProps<{ phase: StorePhase; error: string | null; headingTag?: 'h1' | 'h2' }>(),
  { headingTag: 'h1' },
);
const emit = defineEmits<{ pair: [relayUrl: string, fragment: string] }>();

const link = ref('');
const invalid = ref(false);

const submit = (value: string): void => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    invalid.value = true;
    return;
  }
  if (pairing.parse(url.hash) === null) {
    invalid.value = true;
    return;
  }
  invalid.value = false;
  // The tap that pairs is the gesture the notification permission dialog needs; the
  // subscription itself follows once the box has said hello.
  requestPushPermission();
  emit('pair', url.origin, url.hash);
};

// Destructured so the template can bind `ref="video"` to the composable's element ref.
const { supported, active, error: camera, video, start, stop } = useScanner(submit);
const busy = computed(() => props.phase === 'booting' || props.phase === 'pairing');
const heading = computed(() => {
  if (props.phase === 'booting') return 'Loading…';
  if (props.phase === 'pairing') return 'Pairing…';
  return 'Pair with your box';
});
const message = computed(() => {
  if (invalid.value) return 'That is not a pairing link.';
  return props.error ?? camera.value;
});
</script>

<template>
  <section class="pair">
    <component :is="props.headingTag">{{ heading }}</component>
    <p class="hint">Run <code>flux pair</code> on the box and scan the QR code it prints.</p>
    <video v-show="active" ref="video" class="camera" playsinline muted />
    <button v-if="supported && !active" type="button" :disabled="busy" @click="start">
      Scan QR code
    </button>
    <button v-if="active" type="button" class="secondary" @click="stop">Stop camera</button>
    <form class="paste" @submit.prevent="submit(link)">
      <label for="pair-link">Or paste the link</label>
      <input
        id="pair-link"
        v-model="link"
        type="url"
        placeholder="https://relay.example/#…"
        autocomplete="off"
        :disabled="busy"
      />
      <button type="submit" class="secondary" :disabled="busy || link === ''">Pair</button>
    </form>
    <p v-if="message !== null" class="error">{{ message }}</p>
  </section>
</template>

<style scoped>
.pair {
  margin: auto;
  padding: 1.5rem;
  max-width: 28rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

h1,
h2 {
  font-size: 1.4rem;
  margin: 0;
}

.hint {
  color: var(--muted);
  margin: 0;
}

.camera {
  width: 100%;
  border-radius: var(--radius);
  background: var(--panel);
}

.paste {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.error {
  color: var(--danger);
  margin: 0;
}
</style>
