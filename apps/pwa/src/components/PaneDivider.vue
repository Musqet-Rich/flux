<script setup lang="ts">
import { ref } from 'vue';

import { splitAt } from '../store/split-at.ts';

// The bar between the chat and the side pane on a wide screen (ADR 0033). A drag reports the
// pointer's x while it lasts and `done` when it ends having moved, so the parent sizes live and
// keeps the place once; the keyboard's ← and → step it for whoever cannot drag, `done` when
// the key is let go so a held key is one write. The pointer is captured so a fast drag that
// leaves the bar keeps resizing, and only that pointer counts: a second finger on the bar
// while one drags is ignored, as is any button but the main one.

const emit = defineEmits<{ drag: [x: number]; done: []; step: [by: number] }>();

defineProps<{ share: number }>();

// The pointer dragging, null between drags.
const dragging = ref<number | null>(null);

const onDown = (event: PointerEvent): void => {
  if (event.button !== 0 || dragging.value !== null) return;
  event.preventDefault();
  const bar = event.currentTarget;
  if (!(bar instanceof HTMLElement)) return;
  const id = event.pointerId;
  dragging.value = id;
  bar.setPointerCapture(id);
  let moved = false;
  const move = (e: PointerEvent): void => {
    if (e.pointerId !== id) return;
    moved = true;
    emit('drag', e.clientX);
  };
  const up = (e: PointerEvent): void => {
    if (e.pointerId !== id) return;
    bar.removeEventListener('pointermove', move);
    bar.removeEventListener('pointerup', up);
    bar.removeEventListener('pointercancel', up);
    dragging.value = null;
    if (moved) emit('done');
  };
  bar.addEventListener('pointermove', move);
  bar.addEventListener('pointerup', up);
  bar.addEventListener('pointercancel', up);
};

const arrow = (event: KeyboardEvent): number =>
  event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
const onKeyDown = (event: KeyboardEvent): void => {
  const by = arrow(event);
  if (by === 0) return;
  event.preventDefault();
  emit('step', by);
};
const onKeyUp = (event: KeyboardEvent): void => {
  if (arrow(event) !== 0) emit('done');
};
</script>

<template>
  <div
    class="divider"
    :class="{ dragging: dragging !== null }"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize panes"
    :aria-valuenow="Math.round(share * 100)"
    :aria-valuemin="splitAt.min * 100"
    :aria-valuemax="splitAt.max * 100"
    tabindex="0"
    @pointerdown="onDown"
    @keydown="onKeyDown"
    @keyup="onKeyUp"
  ></div>
</template>

<style scoped>
/* As wide as the row says (`--divider`), the line drawn down its middle, a cursor that says it
   moves, and a hit area reaching out under both panes' edges, since a fingertip on a tablet
   held sideways, wide enough for the split, cannot land on the bar itself. */
.divider {
  position: relative;
  flex: none;
  width: var(--divider);
  cursor: col-resize;
  background: linear-gradient(
    to right,
    transparent 2px,
    var(--border) 2px,
    var(--border) 4px,
    transparent 4px
  );
  touch-action: none;
}

.divider::before {
  content: '';
  position: absolute;
  inset: 0 -8px;
}

.divider:hover,
.divider.dragging,
.divider:focus-visible {
  background: var(--accent);
  outline: none;
}
</style>
