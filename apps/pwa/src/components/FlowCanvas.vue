<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

// The hero's phosphor particle flow: ~210 green sine-wave streaks drifting rightwards on a
// canvas behind the headline. A requestAnimationFrame loop draws them; a ResizeObserver keeps
// the backing store matched to the element. Both are torn down on unmount so nothing leaks.
// Honours prefers-reduced-motion: reduce by never starting the loop (the hero stays static),
// and thins the field on narrow screens so a phone paints fewer strokes.

interface Streak {
  x: number;
  y: number;
  sp: number;
  amp: number;
  ph: number;
  fq: number;
  len: number;
  a: number;
}

const canvas = ref<HTMLCanvasElement | null>(null);
let raf = 0;
let observer: ResizeObserver | null = null;

// A decorative field wants many floats in [0, 1); the lint rule bars Math.random, so draw them
// from a refilling pool of crypto bytes instead (engineering.md § Security).
const pool = new Uint32Array(256);
let poolIndex = pool.length;
const rand = (): number => {
  if (poolIndex >= pool.length) {
    crypto.getRandomValues(pool);
    poolIndex = 0;
  }
  const value = pool[poolIndex] ?? 0;
  poolIndex += 1;
  return value / 4294967296;
};

const makeStreaks = (count: number): Streak[] =>
  Array.from({ length: count }, () => ({
    x: rand(),
    y: rand(),
    sp: 0.0004 + rand() * 0.0012,
    amp: 8 + rand() * 26,
    ph: rand() * Math.PI * 2,
    fq: 0.5 + rand() * 1.5,
    len: 18 + rand() * 60,
    a: 0.06 + rand() * 0.22,
  }));

const draw = (
  ctx: CanvasRenderingContext2D,
  streaks: Streak[],
  w: number,
  h: number,
  dpr: number,
  t: number,
): void => {
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = dpr;
  for (const p of streaks) {
    p.x += p.sp;
    if (p.x > 1.05) {
      p.x = -0.08;
      p.y = rand();
    }
    const px = p.x * w;
    const py = p.y * h + Math.sin(t * p.fq * 2 + p.ph + p.x * 6) * p.amp * dpr;
    const streakLen = p.len * dpr;
    const gradient = ctx.createLinearGradient(px - streakLen, py, px, py);
    gradient.addColorStop(0, 'rgba(98,232,160,0)');
    gradient.addColorStop(1, `rgba(98,232,160,${p.a})`);
    ctx.strokeStyle = gradient;
    ctx.beginPath();
    for (let i = 0; i <= 8; i += 1) {
      const fx = px - streakLen + (streakLen / 8) * i;
      const fy = p.y * h + Math.sin(t * p.fq * 2 + p.ph + (fx / w) * 6) * p.amp * dpr;
      if (i === 0) ctx.moveTo(fx, fy);
      else ctx.lineTo(fx, fy);
    }
    ctx.stroke();
  }
};

onMounted(() => {
  const element = canvas.value;
  const ctx = element?.getContext('2d') ?? null;
  if (element === null || ctx === null) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const dpr = window.devicePixelRatio || 1;
  let w = 0;
  let h = 0;
  const fit = (): void => {
    const rect = element.getBoundingClientRect();
    w = element.width = rect.width * dpr;
    h = element.height = rect.height * dpr;
  };
  fit();
  observer = new ResizeObserver(fit);
  observer.observe(element);

  const streaks = makeStreaks(window.innerWidth < 640 ? 90 : 210);
  let t = 0;
  const tick = (): void => {
    t += 0.008;
    draw(ctx, streaks, w, h, dpr, t);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
});

onBeforeUnmount(() => {
  if (raf !== 0) cancelAnimationFrame(raf);
  observer?.disconnect();
});
</script>

<template>
  <canvas ref="canvas" class="flow" aria-hidden="true"></canvas>
</template>

<style scoped>
.flow {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
