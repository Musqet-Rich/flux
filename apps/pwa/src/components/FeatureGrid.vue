<script setup lang="ts">
// The homepage's "what you get" grid: eight bordered cells, numbered in mono, on the
// editorial-brutalist landing, wrapping to as many columns as fit. The --flux-* custom
// properties are inherited from the .home wrapper in Home.vue.

const features = [
  {
    num: '01',
    title: 'Agents on a box',
    body: 'Claude Code, pi or opencode, one per session in its own git worktree, running unattended so your laptop stays free. Pick the model and effort from your phone.',
  },
  {
    num: '02',
    title: 'Review from anywhere',
    body: 'Replies stream in as they are written. Open changed files as diffs, comment on exact lines, edit a file, then commit, push and open the PR without a terminal.',
  },
  {
    num: '03',
    title: "Know when you're needed",
    body: 'Push notifications when an agent asks a question, says it is done or stuck, or finishes its turn. Tap one to land in that session and answer.',
  },
  {
    num: '04',
    title: 'Subagents in plain sight',
    body: 'A strip lists every subagent and what it is doing. Each one has its own chat, so you can read its work without losing the main thread.',
  },
  {
    num: '05',
    title: 'Files both ways',
    body: 'Send a screenshot, a log or a spec to the agent. When it makes a report or an export for you, it offers the file to download.',
  },
  {
    num: '06',
    title: 'Every machine, one app',
    body: 'Pair a work server and a hobby box, switch between them from the header, and get notifications from both.',
  },
  {
    num: '07',
    title: 'Made for a phone',
    body: 'Stop sits where your thumb is, inline code copies with a tap, and a command runner handles quick one-off commands. On a laptop the chat and your files sit side by side.',
  },
  {
    num: '08',
    title: 'End-to-end encrypted',
    body: "A blind relay passes encrypted bytes even the host can't read. Hosted for you, or self-host it. No accounts, no third parties.",
  },
];
</script>

<template>
  <section id="get" class="features">
    <h2 class="kicker">// WHAT YOU GET</h2>
    <div class="cards">
      <div v-for="f in features" :key="f.num" class="cell">
        <span class="cell-num">{{ f.num }}</span>
        <h3>{{ f.title }}</h3>
        <p>{{ f.body }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.features {
  max-width: var(--flux-max);
  margin: 0 auto;
  padding: 0 clamp(16px, 5vw, 40px) clamp(56px, 8vw, 88px);
}

.kicker {
  font-family: var(--flux-mono);
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0.15em;
  color: oklch(0.55 0.03 150);
  margin: 0 0 28px;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(250px, 100%), 1fr));
  gap: 1px;
  background: var(--flux-line);
  border: 1px solid var(--flux-line);
}

.cell {
  background: oklch(0.15 0.012 150);
  padding: 30px 26px 38px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  transition: background 0.15s ease;
}

.cell:hover {
  background: oklch(0.18 0.02 150);
}

.cell-num {
  font-family: var(--flux-mono);
  font-size: 12px;
  color: var(--flux-accent);
}

.cell h3 {
  font-size: 22px;
  font-weight: 500;
  margin: 0;
  color: oklch(0.95 0.01 150);
  text-wrap: balance;
}

.cell p {
  font-size: 14.5px;
  line-height: 1.65;
  margin: 0;
  color: oklch(0.66 0.03 150);
}
</style>
