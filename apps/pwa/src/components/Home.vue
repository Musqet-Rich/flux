<script setup lang="ts">
import FeatureGrid from './FeatureGrid.vue';
import FlowCanvas from './FlowCanvas.vue';
import Pair from './Pair.vue';
import SetupSteps from './SetupSteps.vue';
import type { StorePhase } from '../store/store-state.ts';

// The unpaired landing (editorial-brutalist v2): what Flux is, what you get, how to set a box
// up, and the connect card (an embedded Pair) that scans the QR or takes a pasted link. App
// shows it until a device is paired; the pairing flow it forwards is byte-identical to the
// standalone Pair screen. A phosphor grid, a radial glow and the FlowCanvas streaks sit behind
// the hero; the whole page is dark-only and folds to one column on a phone.

defineProps<{ phase: StorePhase; error: string | null }>();
const emit = defineEmits<{ pair: [relayUrl: string, fragment: string] }>();

const onPair = (relayUrl: string, fragment: string): void => {
  emit('pair', relayUrl, fragment);
};
</script>

<template>
  <main class="home">
    <div class="grid-backdrop" aria-hidden="true"></div>
    <div class="glow" aria-hidden="true"></div>

    <div class="page">
      <nav class="nav">
        <div class="brand">
          <span class="dot"></span>
          <span class="wordmark">FLUX</span>
          <span class="daemon">[daemon: listening]</span>
        </div>
        <div class="nav-links">
          <a href="#get">./features</a>
          <a href="#setup">./setup</a>
          <a href="#pair" class="pair-now">pair --now</a>
        </div>
      </nav>

      <header class="hero">
        <FlowCanvas />
        <div class="hero-inner">
          <p class="eyebrow">
            ~/flux <span class="dim">on box</span> <span class="dim">·</span> permissions bypassed
          </p>
          <h1>Give coding agents their own <span class="accent">computer.</span></h1>
          <div class="hero-body">
            <p class="lede">
              Run Claude Code and pi.dev on a box you control with permissions bypassed, on long
              tasks — then steer and review them from your phone or laptop.
            </p>
            <div class="terminal">
              <div class="term-bar">
                <span class="tdot"></span>
                <span class="tdot"></span>
                <span>box:~</span>
              </div>
              <div class="term-body">
                <div><span class="prompt">$</span> flux pair</div>
                <div class="term-out">⠿ QR + link printed. Valid 10 min.</div>
                <div><span class="prompt">$</span> <span class="cursor"></span></div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <FeatureGrid />
      <SetupSteps />

      <section id="pair" class="connect">
        <Pair :phase="phase" :error="error" heading-tag="h2" @pair="onPair" />
      </section>

      <footer class="footer">
        <span>FLUX — A DUMB RELAY YOU HOST PASSES ENCRYPTED BYTES IT CANNOT READ.</span>
        <span>MIT LICENSE</span>
      </footer>
    </div>
  </main>
</template>

<style scoped>
@import '../styles/fonts.css';

.home {
  --flux-accent: oklch(0.85 0.19 145);
  --flux-sans: 'Space Grotesk', system-ui, sans-serif;
  --flux-mono: 'IBM Plex Mono', ui-monospace, Menlo, monospace;
  --flux-line: oklch(0.28 0.03 150);
  --flux-max: 1160px;

  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background: oklch(0.13 0.01 150);
  color: oklch(0.88 0.02 150);
  font-family: var(--flux-sans);
  -webkit-font-smoothing: antialiased;
}

.grid-backdrop {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(oklch(0.85 0.19 145 / 0.05) 1px, transparent 1px),
    linear-gradient(90deg, oklch(0.85 0.19 145 / 0.05) 1px, transparent 1px);
  background-size: 48px 48px;
  pointer-events: none;
}

.glow {
  position: absolute;
  top: -200px;
  left: 50%;
  transform: translateX(-50%);
  width: min(900px, 100vw);
  height: 500px;
  background: radial-gradient(ellipse, oklch(0.85 0.19 145 / 0.13), transparent 65%);
  pointer-events: none;
}

.page {
  position: relative;
}

/* nav */
.nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 18px clamp(16px, 5vw, 40px);
  border-bottom: 1px solid var(--flux-line);
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: var(--flux-mono);
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--flux-accent);
  box-shadow: 0 0 12px var(--flux-accent);
  animation: flux-pulse 2.4s ease infinite;
}

.wordmark {
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0.12em;
  color: oklch(0.95 0.02 150);
}

.daemon {
  font-size: 11px;
  color: oklch(0.55 0.03 150);
}

.nav-links {
  display: flex;
  align-items: center;
  gap: clamp(14px, 3vw, 26px);
  font-family: var(--flux-mono);
  font-size: 12px;
}

.nav-links a {
  color: oklch(0.7 0.04 150);
  text-decoration: none;
}

.nav-links a:hover {
  color: oklch(0.92 0.16 145);
}

.pair-now {
  padding: 9px 18px;
  border: 1px solid var(--flux-accent);
  color: var(--flux-accent) !important;
}

.pair-now:hover {
  background: var(--flux-accent);
  color: oklch(0.13 0.01 150) !important;
}

/* hero */
.hero {
  position: relative;
  animation: flux-rise 0.7s ease both;
}

.hero-inner {
  position: relative;
  max-width: var(--flux-max);
  margin: 0 auto;
  padding: clamp(48px, 9vw, 100px) clamp(16px, 5vw, 40px) clamp(48px, 8vw, 80px);
}

.eyebrow {
  font-family: var(--flux-mono);
  font-size: 13px;
  color: var(--flux-accent);
  margin: 0 0 24px;
}

.eyebrow .dim {
  color: oklch(0.55 0.03 150);
}

.hero h1 {
  font-size: clamp(40px, 7vw, 96px);
  font-weight: 700;
  line-height: 1.02;
  letter-spacing: -0.03em;
  margin: 0;
  color: oklch(0.97 0.01 150);
  text-wrap: balance;
}

.hero h1 .accent {
  color: var(--flux-accent);
  text-shadow: 0 0 32px oklch(0.85 0.19 145 / 0.45);
}

.hero-body {
  display: flex;
  flex-wrap: wrap;
  gap: clamp(28px, 5vw, 48px);
  align-items: flex-start;
  justify-content: space-between;
  margin-top: 44px;
}

.lede {
  flex: 1 1 320px;
  max-width: 540px;
  font-size: clamp(16px, 2.4vw, 19px);
  line-height: 1.6;
  margin: 0;
  color: oklch(0.72 0.03 150);
}

.terminal {
  flex: 1 1 300px;
  max-width: 380px;
  background: oklch(0.16 0.012 150);
  border: 1px solid oklch(0.32 0.04 150);
  box-shadow: 0 0 40px oklch(0.85 0.19 145 / 0.08);
  font-family: var(--flux-mono);
  font-size: 13px;
  line-height: 1.7;
}

.term-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--flux-line);
  color: oklch(0.55 0.03 150);
  font-size: 11px;
}

.tdot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: oklch(0.4 0.05 150);
}

.term-body {
  padding: 16px 18px;
}

.term-out {
  color: oklch(0.55 0.03 150);
}

.prompt {
  color: var(--flux-accent);
}

.cursor {
  display: inline-block;
  width: 8px;
  height: 15px;
  background: var(--flux-accent);
  vertical-align: -2px;
  animation: flux-blink 1.1s step-end infinite;
}

/* pair */
.connect {
  border-top: 1px solid var(--flux-line);
}

/* footer */
.footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 22px clamp(16px, 5vw, 40px);
  border-top: 1px solid var(--flux-line);
  font-family: var(--flux-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  color: oklch(0.5 0.03 150);
}

@keyframes flux-blink {
  0%,
  49% {
    opacity: 1;
  }
  50%,
  100% {
    opacity: 0;
  }
}

@keyframes flux-rise {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes flux-pulse {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero {
    animation: none;
  }
  .dot,
  .cursor {
    animation: none;
  }
}
</style>
