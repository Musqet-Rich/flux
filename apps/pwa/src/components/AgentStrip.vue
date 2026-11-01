<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from 'vue';

import type { IconName } from '../icons/icons.ts';
import type { SessionTask } from '../store/session-tasks.ts';
import Icon from './Icon.vue';

// The agents of one session, as Claude Code's own TUI lists them under its status bar: `main`
// first, then one row per subagent task, nested tasks indented under the task that spawned
// them. A running task's line is its latest progress note when it has sent one, else its
// description. The selected row is the chat the timeline shows. Rendered only when there are
// tasks. The rows are the caller's cut: the current tasks (store/session-tasks) plus the open
// chat's, so a strip of one ended row from an old turn is the operator's way back.
//
// Folded, the strip is one line that opens it again: a caret, a spinner while anything runs,
// the open chat's name and how many subagents there are and how many run, so the space goes to
// the timeline without losing sight of the work. Open, the caret sits at the end of `main`'s
// row. Whether it is folded is the caller's (store/folded-strips: per session, per device).

const props = defineProps<{
  tasks: SessionTask[];
  active: string | null;
  busy: boolean;
  folded: boolean;
}>();
const emit = defineEmits<{ select: [view: string | null]; fold: [folded: boolean] }>();

const running = computed(() => props.tasks.filter((t) => t.status === 'running').length);
const viewing = computed(() => {
  if (props.active === null) return 'main';
  const open = props.tasks.find((t) => t.toolUseId === props.active);
  return open?.agentType ?? 'agent';
});
const spinning = computed(() => props.busy || running.value > 0);
// Subagents only: `main` is the line's name when it is the open chat, never one of the count.
const count = computed(() => {
  const agents = `${props.tasks.length} ${props.tasks.length === 1 ? 'subagent' : 'subagents'}`;
  return running.value === 0 ? agents : `${agents}, ${running.value} running`;
});
// The line's text says what is there, not what a tap does, so the name says both.
const unfoldName = computed(() => `Show agents: ${viewing.value}, ${count.value}`);

// Folding swaps one control for the other, so the one pressed is gone: the focus follows to
// its counterpart rather than dropping to the page. Only a press here moves it; a fold the
// caller sets (another session's screen) leaves the focus where it is.
const foldButton = useTemplateRef<HTMLButtonElement>('foldButton');
const unfoldButton = useTemplateRef<HTMLButtonElement>('unfoldButton');
let pressed = false;
const toggle = (next: boolean): void => {
  pressed = true;
  emit('fold', next);
};
watch(
  () => props.folded,
  async (folded) => {
    if (!pressed) return;
    pressed = false;
    await nextTick();
    (folded ? unfoldButton : foldButton).value?.focus();
  },
);

// A spinner while running, a tick once ended, a cross when it failed or the session moved on
// without it.
const glyph = (status: string): IconName => (status === 'completed' ? 'succeeded' : 'failed');

const tone = (status: string): string => {
  if (status === 'running' || status === 'completed') return '';
  return status === 'interrupted' ? 'muted' : 'failed';
};
</script>

<template>
  <nav v-if="folded" class="agents" aria-label="Agents">
    <button
      type="button"
      ref="unfoldButton"
      class="row unfold"
      aria-expanded="false"
      :aria-label="unfoldName"
      title="Show agents"
      @click="toggle(false)"
    >
      <span class="glyph"><Icon name="forward" class="caret" /></span>
      <span v-if="spinning" class="loader" aria-hidden="true" />
      <span class="type">{{ viewing }}</span>
      <span class="description">{{ count }}</span>
    </button>
  </nav>
  <nav v-else class="agents" aria-label="Agents">
    <div class="head">
      <button
        type="button"
        class="row main"
        :class="{ active: active === null }"
        :aria-pressed="active === null"
        @click="$emit('select', null)"
      >
        <span v-if="busy" class="loader" aria-hidden="true" />
        <span v-else class="glyph"><Icon name="dot" /></span>
        <span class="type">main</span>
      </button>
      <button
        type="button"
        ref="foldButton"
        class="icon-only fold"
        aria-expanded="true"
        aria-label="Hide agents"
        title="Hide agents"
        @click="toggle(true)"
      >
        <Icon name="forward" class="caret open" />
      </button>
    </div>
    <button
      v-for="task in tasks"
      :key="task.taskId"
      type="button"
      class="row"
      :class="[tone(task.status), { active: active === task.toolUseId }]"
      :style="{ paddingLeft: `${0.75 + task.depth}rem` }"
      :aria-pressed="active === task.toolUseId"
      :title="task.status"
      @click="$emit('select', task.toolUseId)"
    >
      <span v-if="task.status === 'running'" class="loader" aria-hidden="true" />
      <span v-else class="glyph"><Icon :name="glyph(task.status)" /></span>
      <span class="type">{{ task.agentType ?? 'agent' }}</span>
      <span class="description">{{ task.progress ?? task.description }}</span>
    </button>
  </nav>
</template>

<style scoped>
.agents {
  flex: none;
  display: flex;
  flex-direction: column;
  /* Four rows on a phone, then the strip scrolls rather than eating the timeline. */
  max-height: 6.4rem;
  overflow-y: auto;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}

/* Kept in view while the rows scroll: a long list is when folding is wanted. */
.head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  background: var(--panel);
}

.head .main {
  flex: 1;
}

/* The fold control matches a row's height and sits at its end, wider than an icon and ruled
   off so a near miss does not open `main`, in the strip's colours. */
.fold {
  flex: none;
  min-width: 2.75rem;
  padding: 0 0.75rem;
  border-left: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-size: 0.8rem;
}

.fold:hover,
.fold:focus-visible,
.unfold:hover,
.unfold:focus-visible {
  color: var(--fg);
}

/* One caret drawing, turned down while the strip is open. */
.caret.open {
  transform: rotate(90deg);
}

.row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.25rem 0.75rem;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-size: 0.8rem;
  line-height: 1.6;
  text-align: left;
}

.row.active {
  color: var(--fg);
  background: var(--panel-2);
}

.row.failed {
  color: var(--danger);
}

.glyph,
.loader {
  flex: none;
  width: 1rem;
  text-align: center;
}

.glyph {
  display: inline-flex;
  justify-content: center;
}

.main .glyph {
  font-size: 0.6rem;
}

.type {
  flex: none;
  font-family: var(--font-code);
}

.description {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
