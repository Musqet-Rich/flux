<script setup lang="ts">
// The homepage's "what you get" grid: four bordered cells, numbered in mono, on the
// editorial-brutalist landing. The --flux-* custom properties are inherited from the .home
// wrapper in Home.vue.

const features = [
  {
    num: '01',
    title: 'Agents on a box',
    body: 'Each session is one agent in its own git worktree, running unattended so your laptop stays free.',
  },
  {
    num: '02',
    title: 'Review from anywhere',
    body: 'Read replies stream in, open changed files as diffs, and leave comments on the exact lines.',
  },
  {
    num: '03',
    title: "Know when you're needed",
    body: 'Push notifications when an agent asks a question or goes idle. Answer from the notification.',
  },
  {
    num: '04',
    title: 'End-to-end encrypted',
    body: 'A dumb relay you host passes encrypted bytes it cannot read. No accounts, no third parties.',
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
