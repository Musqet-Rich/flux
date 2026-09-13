<script setup lang="ts">
import type { SessionSummary } from '@flux/protocol';
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';

import { escapeStack } from './escape-stack.ts';
import type { SwitchKey } from '../store/store-state.ts';
import Icon from './Icon.vue';
import { switchChord } from './switch-chord.ts';

// One tab per session in creation order, plus the way to a new one. The order never follows
// activity: with two agents working, sorting by last event made the tabs swap under the thumb.
// Activity is shown instead: the state dot, and a count of events since the tab was last active.
// The strip is on every paired screen, so its keyboard is too: the device's switch chord
// (switch-chord.ts) steps along the tabs in this order, wrapping, and from a screen with no
// session (the list, New, Settings) → lands on the first tab and ← on the last. Not while
// something is open on top (the help modal, a rename sheet, a menu: escape-stack.ts), which
// would be left standing over a screen it does not belong to; and the key is taken only when
// a switch happens, so with one tab ⌘← is still the browser's Back.

const props = defineProps<{
  sessions: SessionSummary[];
  active: string | null;
  chord: SwitchKey;
}>();
const emit = defineEmits<{ select: [session: string]; create: [] }>();

// `createdAt` is absent from a daemon older than the field; the id alone still keeps the tabs put.
const byCreation = (a: SessionSummary, b: SessionSummary): number =>
  (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.session.localeCompare(b.session);

// Archived sessions live in the list screen's Archived section, not in the strip.
const ordered = computed(() =>
  props.sessions.filter((s) => s.archived !== true).toSorted(byCreation),
);

// The last seq each tab was seen at: kept current while it is active, frozen once it is not, so
// the difference is what arrived behind the operator's back. A session first seen (hello, a
// reconnect) counts as read: the operator has nothing to catch up on until a new event lands.
const seen = reactive(new Map<string, number>());

watch(
  () => ({
    active: props.active,
    seqs: props.sessions.map((s) => [s.session, s.lastSeq] as const),
  }),
  ({ active, seqs }) => {
    for (const [session, lastSeq] of seqs) {
      if (session === active || !seen.has(session)) seen.set(session, lastSeq);
    }
  },
  { immediate: true },
);

const unread = (s: SessionSummary): number => Math.max(0, s.lastSeq - (seen.get(s.session) ?? 0));

const onKey = (event: KeyboardEvent): void => {
  const step = switchChord.step(props.chord, event, switchChord.apple);
  if (step === 0 || escapeStack.open()) return;
  const list = ordered.value;
  const at = list.findIndex((s) => s.session === props.active);
  const to = at < 0 ? (step > 0 ? 0 : list.length - 1) : (at + step + list.length) % list.length;
  const target = list[to];
  if (target === undefined || target.session === props.active) return;
  event.preventDefault();
  emit('select', target.session);
};
onMounted(() => {
  window.addEventListener('keydown', onKey);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKey);
});

const tabs = ref<HTMLElement[]>([]);

// Only an explicit selection or a creation changes `active`, so those are the only times the
// strip scrolls; background activity does not move it.
watch(
  () => props.active,
  (active) => {
    const el = tabs.value.find((t) => t.dataset['session'] === active);
    el?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  },
  { flush: 'post' },
);
</script>

<template>
  <nav class="tabs" aria-label="Sessions">
    <button
      v-for="s in ordered"
      ref="tabs"
      :key="s.session"
      type="button"
      class="tab"
      :class="{ active: s.session === active }"
      :data-session="s.session"
      :title="`${s.repo} · ${s.branch}`"
      @click="$emit('select', s.session)"
    >
      <span class="dot" :class="s.state" />
      <span class="title">{{ s.title }}</span>
      <span v-if="unread(s) > 0" class="unread" :aria-label="`${unread(s)} new`">
        {{ unread(s) }}
      </span>
    </button>
    <button
      type="button"
      class="tab add icon-only"
      aria-label="New session"
      title="New session"
      @click="$emit('create')"
    >
      <Icon name="plus" />
    </button>
  </nav>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 0.25rem;
  overflow-x: auto;
  padding: 0.4rem 0.5rem;
  scrollbar-width: none;
}

.tab {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: transparent;
  color: var(--muted);
  border: 1px solid transparent;
  border-radius: var(--radius);
  padding: 0.4rem 0.7rem;
  max-width: 12rem;
}

.tab.active {
  background: var(--panel-2);
  color: var(--fg);
  border-color: var(--border);
}

.title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.add {
  font-size: 1.05rem;
  line-height: 1;
  padding: 0.4rem 0.5rem;
}

.dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--muted);
}

.dot.running {
  background: var(--accent);
}

.dot.waiting_user {
  background: var(--warn);
}

.dot.idle {
  background: var(--ok);
}

.unread {
  flex: none;
  min-width: 1.1rem;
  padding: 0 0.3rem;
  border-radius: 0.55rem;
  background: var(--accent);
  color: var(--accent-fg);
  font-size: 0.7rem;
  line-height: 1.1rem;
  text-align: center;
}
</style>
