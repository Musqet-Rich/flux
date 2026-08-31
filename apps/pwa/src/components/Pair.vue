<script setup lang="ts">
import { pairing } from '@flux/protocol';
import { computed, ref } from 'vue';

import { useScanner } from '../composables/useScanner.ts';
import { requestPushPermission } from '../push/request-push-permission.ts';
import type { StorePhase } from '../store/store-state.ts';

// The connect affordance in the editorial-brutalist look: scan the QR that `flux pair` prints,
// or paste the link it encodes. Standalone it heads its own screen (`h1`); the homepage embeds
// it as the `#pair` section (`h2`). The uppercase button labels are CSS only — the DOM text and
// the input's label stay in their original casing so the e2e selectors keep matching.

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
// While the store works, the heading becomes the status; otherwise it is the pairing title
// (split so `your box` can glow green without changing the heading's text content).
const status = computed(() => {
  if (props.phase === 'booting') return 'Loading…';
  if (props.phase === 'pairing') return 'Pairing…';
  return null;
});
const pairLabel = computed(() => (props.phase === 'pairing' ? 'CONNECTING…' : 'Pair'));
const message = computed(() => {
  if (invalid.value) return 'That is not a pairing link.';
  return props.error ?? camera.value;
});
</script>

<template>
  <section class="pair">
    <div class="lede">
      <component :is="props.headingTag" class="title">
        <template v-if="status !== null">{{ status }}</template>
        <template v-else>Pair with <span class="accent">your box</span></template>
      </component>
      <p class="hint">Run <code>flux pair</code> on the box and scan the QR code it prints.</p>
      <p class="trust">NO ACCOUNTS · NO THIRD PARTIES · E2E ENCRYPTED</p>
    </div>

    <div class="card">
      <video v-show="active" ref="video" class="camera" playsinline muted />
      <button
        v-if="supported && !active"
        type="button"
        class="scan"
        :disabled="busy"
        @click="start"
      >
        Scan QR code
      </button>
      <button v-if="active" type="button" class="stop" @click="stop">Stop camera</button>
      <p class="divider">· Or paste the link ·</p>
      <form class="paste" @submit.prevent="submit(link)">
        <label for="pair-link" class="visually-hidden">Or paste the link</label>
        <input
          id="pair-link"
          v-model="link"
          type="url"
          placeholder="https://relay.example/#…"
          autocomplete="off"
          :disabled="busy"
        />
        <button type="submit" class="do-pair" :disabled="busy || link === ''">
          {{ pairLabel }}
        </button>
      </form>
      <p v-if="message !== null" class="error">{{ message }}</p>
    </div>
  </section>
</template>

<style scoped>
.pair {
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  gap: 64px;
  align-items: center;
  max-width: var(--flux-max, 1160px);
  margin: 0 auto;
  padding: 88px 40px;
}

.lede {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.title {
  font-size: clamp(2.2rem, 5vw, 52px);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.05;
  margin: 0;
  color: oklch(0.97 0.01 150);
}

.accent {
  color: var(--flux-accent);
  text-shadow: 0 0 28px oklch(0.85 0.19 145 / 0.4);
}

.hint {
  font-size: 17px;
  line-height: 1.6;
  margin: 0;
  color: oklch(0.7 0.03 150);
}

.hint code {
  font-family: var(--flux-mono);
  font-size: 15px;
  color: var(--flux-accent);
  background: none;
  padding: 0;
}

.trust {
  font-family: var(--flux-mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  color: oklch(0.55 0.03 150);
  margin: 0;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: oklch(0.16 0.012 150);
  border: 1px solid oklch(0.32 0.04 150);
  padding: 30px;
  box-shadow: 0 0 60px oklch(0.85 0.19 145 / 0.07);
}

.camera {
  width: 100%;
  background: oklch(0.12 0.01 150);
  border: 1px solid oklch(0.32 0.04 150);
}

.scan {
  font-family: var(--flux-mono);
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 15px;
  background: var(--flux-accent);
  color: oklch(0.13 0.01 150);
  border: none;
  border-radius: 0;
  cursor: pointer;
}

.scan:hover:not(:disabled) {
  background: oklch(0.92 0.16 145);
}

.stop {
  font-family: var(--flux-mono);
  font-size: 13px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 13px;
  background: transparent;
  color: oklch(0.7 0.03 150);
  border: 1px solid oklch(0.32 0.04 150);
  border-radius: 0;
  cursor: pointer;
}

.divider {
  font-family: var(--flux-mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: oklch(0.55 0.03 150);
  text-align: center;
  margin: 4px 0 0;
}

.paste {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.paste input {
  font-family: var(--flux-mono);
  font-size: 13px;
  padding: 14px 15px;
  background: oklch(0.12 0.01 150);
  border: 1px solid oklch(0.32 0.04 150);
  border-radius: 0;
  color: oklch(0.9 0.02 150);
  outline: none;
}

.paste input:focus {
  border-color: var(--flux-accent);
}

.do-pair {
  font-family: var(--flux-mono);
  font-size: 14px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 13px;
  background: transparent;
  color: var(--flux-accent);
  border: 1px solid oklch(0.45 0.08 150);
  border-radius: 0;
  cursor: pointer;
}

.do-pair:hover:not(:disabled) {
  border-color: var(--flux-accent);
}

.error {
  font-family: var(--flux-mono);
  font-size: 12px;
  color: var(--danger);
  margin: 0;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 720px) {
  .pair {
    grid-template-columns: 1fr;
    gap: 32px;
    padding: 56px 20px;
  }

  .card {
    padding: 20px;
  }
}
</style>
