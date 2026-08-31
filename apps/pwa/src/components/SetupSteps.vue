<script setup lang="ts">
// The homepage's "setup" section: a numbered step list on the editorial-brutalist landing. A
// step is a sequence of inline segments so one line can mix prose, a shell command and a link.
// The --flux-* custom properties are inherited from the .home wrapper in Home.vue.

type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

interface Step {
  num: string;
  segments: Segment[];
}

const steps: Step[] = [
  {
    num: '1',
    segments: [
      { kind: 'text', text: 'Install the Flux daemon on your box: ' },
      {
        kind: 'code',
        text: 'curl -fsSL https://raw.githubusercontent.com/Musqet-Rich/flux/main/scripts/install.sh | sh',
      },
    ],
  },
  {
    num: '2',
    segments: [
      { kind: 'text', text: 'Point it at the hosted relay: set ' },
      { kind: 'code', text: 'FLUX_RELAY_URL=https://fluxagent.me' },
      { kind: 'text', text: " in the daemon's environment. Prefer to run your own relay? See " },
      {
        kind: 'link',
        text: 'SELF_HOSTING.md',
        href: 'https://github.com/Musqet-Rich/flux/blob/main/SELF_HOSTING.md',
      },
      { kind: 'text', text: ' for the self-host path.' },
    ],
  },
  {
    num: '3',
    segments: [
      { kind: 'text', text: 'On the box, run ' },
      { kind: 'code', text: 'flux pair' },
      { kind: 'text', text: '. It prints a QR code and a link, valid for ten minutes.' },
    ],
  },
  {
    num: '4',
    segments: [
      {
        kind: 'text',
        text: "Scan the QR below, or paste its link. Accept the notification prompt, and you're connected.",
      },
    ],
  },
];

const linkHref = (seg: Segment): string | undefined => (seg.kind === 'link' ? seg.href : undefined);
</script>

<template>
  <section id="setup" class="setup">
    <div class="setup-inner">
      <p class="kicker">// SETUP</p>
      <h2>Set up in a minute.</h2>
      <ol class="steps">
        <li v-for="s in steps" :key="s.num">
          <span class="step-num">[{{ s.num }}]</span>
          <p>
            <template v-for="(seg, i) in s.segments" :key="i">
              <code v-if="seg.kind === 'code'">{{ seg.text }}</code>
              <a
                v-else-if="seg.kind === 'link'"
                :href="linkHref(seg)"
                target="_blank"
                rel="noopener"
                >{{ seg.text }}</a
              >
              <template v-else>{{ seg.text }}</template>
            </template>
          </p>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.setup {
  border-top: 1px solid var(--flux-line);
  background: oklch(0.115 0.01 150);
}

.setup-inner {
  max-width: var(--flux-max);
  margin: 0 auto;
  padding: clamp(48px, 8vw, 72px) clamp(16px, 5vw, 40px) clamp(56px, 8vw, 88px);
}

.kicker {
  font-family: var(--flux-mono);
  font-size: 12px;
  letter-spacing: 0.15em;
  color: oklch(0.55 0.03 150);
  margin: 0 0 10px;
}

.setup h2 {
  font-size: clamp(30px, 5vw, 40px);
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0 0 44px;
  color: oklch(0.97 0.01 150);
}

.steps {
  list-style: none;
  margin: 0;
  padding: 0;
}

.steps li {
  display: grid;
  grid-template-columns: 60px 1fr;
  gap: 24px;
  align-items: baseline;
  padding: 22px 0;
  border-top: 1px solid oklch(0.26 0.03 150);
}

.step-num {
  font-family: var(--flux-mono);
  font-size: 14px;
  color: var(--flux-accent);
}

.steps p {
  font-size: 17px;
  line-height: 1.65;
  margin: 0;
  color: oklch(0.78 0.03 150);
}

.steps code {
  font-family: var(--flux-mono);
  font-size: 14px;
  background: oklch(0.2 0.02 150);
  border: 1px solid oklch(0.32 0.04 150);
  padding: 2px 8px;
  color: var(--flux-accent);
  overflow-wrap: anywhere;
}

.steps a {
  color: var(--flux-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

@media (max-width: 720px) {
  .steps li {
    grid-template-columns: 44px 1fr;
    gap: 14px;
  }
}
</style>
