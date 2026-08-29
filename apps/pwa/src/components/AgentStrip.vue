<script setup lang="ts">
import type { SessionTask } from '../store/session-tasks.ts';

// The agents of one session, as Claude Code's own TUI lists them under its status bar: `main`
// first, then one row per subagent task, nested tasks indented under the task that spawned
// them. A running task's line is its latest progress note when it has sent one, else its
// description. The selected row is the chat the timeline shows. Rendered only when there are tasks.

defineProps<{ tasks: SessionTask[]; active: string | null; busy: boolean }>();
defineEmits<{ select: [view: string | null] }>();

// A spinner while running, ○ once ended, ✗ when it failed or the session moved on without it.
const glyph = (status: string): string => (status === 'completed' ? '○' : '✗');

const tone = (status: string): string => {
  if (status === 'running' || status === 'completed') return '';
  return status === 'interrupted' ? 'muted' : 'failed';
};
</script>

<template>
  <nav class="agents" aria-label="Agents">
    <button
      type="button"
      class="row main"
      :class="{ active: active === null }"
      :aria-pressed="active === null"
      @click="$emit('select', null)"
    >
      <span v-if="busy" class="loader" aria-hidden="true" />
      <span v-else class="glyph">●</span>
      <span class="type">main</span>
    </button>
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
      <span v-else class="glyph">{{ glyph(task.status) }}</span>
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

.type {
  flex: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.description {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
