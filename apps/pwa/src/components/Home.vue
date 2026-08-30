<script setup lang="ts">
import Pair from './Pair.vue';
import type { StorePhase } from '../store/store-state.ts';

// The unpaired landing page: what Flux is, what it does, how to set a box up, and the connect
// card (an embedded Pair) that scans the QR or takes a pasted link. App shows it until a device
// is paired; the pairing flow it forwards is byte-identical to the standalone Pair screen.

defineProps<{ phase: StorePhase; error: string | null }>();
const emit = defineEmits<{ pair: [relayUrl: string, fragment: string] }>();

const onPair = (relayUrl: string, fragment: string): void => {
  emit('pair', relayUrl, fragment);
};
</script>

<template>
  <main class="home">
    <header class="hero">
      <p class="wordmark">Flux</p>
      <h1>Give coding agents their own computer.</h1>
      <p class="lede">
        Run Claude Code and pi.dev on a box you control with permissions bypassed, on long tasks —
        then steer and review them from your phone or laptop.
      </p>
    </header>

    <section class="features" aria-labelledby="features-heading">
      <h2 id="features-heading">What you get</h2>
      <ul class="grid">
        <li class="card">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="3" y="4" width="18" height="12" rx="2" />
            <path d="M8 20h8M12 16v4" />
          </svg>
          <h3>Agents on a box</h3>
          <p>
            Each session is one agent in its own git worktree, running unattended so your laptop
            stays free.
          </p>
        </li>
        <li class="card">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M4 5h16M4 12h16M4 19h10" />
            <circle cx="18" cy="19" r="2" />
          </svg>
          <h3>Review from anywhere</h3>
          <p>
            Read replies stream in, open changed files as diffs, and leave comments on the exact
            lines.
          </p>
        </li>
        <li class="card">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 9a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6z" />
            <path d="M10 20a2 2 0 004 0" />
          </svg>
          <h3>Know when you're needed</h3>
          <p>
            Push notifications when an agent asks a question or goes idle. Answer from the
            notification.
          </p>
        </li>
        <li class="card">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 018 0v3" />
          </svg>
          <h3>End-to-end encrypted</h3>
          <p>
            A dumb relay you host passes encrypted bytes it cannot read. No accounts, no third
            parties.
          </p>
        </li>
      </ul>
    </section>

    <section class="setup" aria-labelledby="setup-heading">
      <h2 id="setup-heading">Set up in a minute</h2>
      <ol class="steps">
        <li>
          <span class="num">1</span>
          <p>
            Run the Flux daemon on your box. See <code>SELF_HOSTING.md</code> for the relay and
            daemon.
          </p>
        </li>
        <li>
          <span class="num">2</span>
          <p>
            On the box, run <code>flux pair</code>. It prints a QR code and a link, valid for ten
            minutes.
          </p>
        </li>
        <li>
          <span class="num">3</span>
          <p>
            Scan the QR below, or paste its link. Accept the notification prompt, and you're
            connected.
          </p>
        </li>
      </ol>
    </section>

    <section class="connect" aria-label="Connect a device">
      <Pair :phase="phase" :error="error" heading-tag="h2" @pair="onPair" />
    </section>
  </main>
</template>

<style scoped>
.home {
  flex: 1;
  min-height: 0;
  padding: 2rem 1.25rem 3rem;
  width: 100%;
  box-sizing: border-box;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2.5rem;
}

.home > * {
  width: 100%;
  max-width: 52rem;
  margin-inline: auto;
}

.hero {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.wordmark {
  margin: 0;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--accent);
  text-transform: uppercase;
  font-size: 0.85rem;
}

.hero h1 {
  margin: 0;
  font-size: 1.9rem;
  line-height: 1.15;
}

.lede {
  margin: 0;
  color: var(--muted);
  font-size: 1.05rem;
  max-width: 40rem;
}

h2 {
  margin: 0 0 1rem;
  font-size: 1.25rem;
}

.grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: 1rem;
}

.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.icon {
  width: 1.6rem;
  height: 1.6rem;
  fill: none;
  stroke: var(--accent);
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.card h3 {
  margin: 0;
  font-size: 1rem;
}

.card p {
  margin: 0;
  color: var(--muted);
  font-size: 0.92rem;
}

.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.steps li {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
}

.steps p {
  margin: 0;
}

.num {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 50%;
  background: var(--panel-2);
  border: 1px solid var(--border);
  color: var(--accent);
  font-size: 0.85rem;
  font-weight: 600;
}

code {
  background: var(--panel);
  border-radius: 4px;
  padding: 0.05em 0.35em;
}

.connect {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.5rem 0.5rem 1rem;
}
</style>
