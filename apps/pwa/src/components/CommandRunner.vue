<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import type { Store } from '../store/create-store.ts';
import type { RunnerRun } from '../store/store-state.ts';
import AnsiOutput from './AnsiOutput.vue';

// The operator command runner (ADR 0026 § 7): a distinct screen, not a session tab. It shows each
// one-off command and its streamed, ANSI-coloured output, with a Stop while it runs and a one-tap
// Copy of each run's output. The scrollback is client-only and lives in the store while open.

const props = defineProps<{ store: Store }>();
defineEmits<{ back: [] }>();

const runner = computed(() => props.store.state.runner);
const running = computed(() => runner.value.activeRunId !== null);

const command = ref('');
const copiedRunId = ref<string | null>(null);
const scrollback = ref<HTMLElement | null>(null);

const send = async (): Promise<void> => {
  const text = command.value.trim();
  if (text === '' || running.value) return;
  const runId = await props.store.shellRun(text);
  if (runId !== null) command.value = '';
};

const stop = (): void => {
  const runId = runner.value.activeRunId;
  if (runId !== null) void props.store.shellInterrupt(runId);
};

const copy = async (run: RunnerRun): Promise<void> => {
  try {
    await navigator.clipboard.writeText(run.output);
    copiedRunId.value = run.runId;
    window.setTimeout(() => {
      if (copiedRunId.value === run.runId) copiedRunId.value = null;
    }, 1500);
  } catch {
    // The clipboard is missing off HTTPS or can be refused; not worth an unhandled rejection.
  }
};

// The exit line: a signal reads as killed, otherwise the numeric code; a bounded run says so.
const exitLine = (run: RunnerRun): string => {
  if (run.exit === null) return '';
  const base =
    run.exit.signal === null ? `exit ${run.exit.code ?? '?'}` : `killed (${run.exit.signal})`;
  return run.exit.truncated ? `${base} · output truncated` : base;
};

const isActive = (run: RunnerRun): boolean => runner.value.activeRunId === run.runId;

// Follow the newest output as it streams and as runs are added.
watch(
  () => runner.value.runs.map((run) => `${run.output.length}:${run.exit === null ? 0 : 1}`).join(),
  () => {
    void nextTick(() => {
      const el = scrollback.value;
      if (el !== null) el.scrollTop = el.scrollHeight;
    });
  },
);
</script>

<template>
  <section class="runner">
    <div class="toolbar">
      <button type="button" class="secondary" @click="$emit('back')">‹ Sessions</button>
      <h1>Command runner</h1>
    </div>
    <div ref="scrollback" class="scrollback">
      <p v-if="runner.runs.length === 0" class="empty">
        Run a one-off command on the box. Each runs on its own — there is no shell state between
        them.
      </p>
      <article v-for="run in runner.runs" :key="run.runId" class="run">
        <div class="head">
          <code class="command"><span class="prompt">$</span> {{ run.command }}</code>
          <div class="actions">
            <button
              v-if="isActive(run)"
              type="button"
              class="secondary stop"
              aria-label="Stop the running command"
              @click="stop"
            >
              Stop
            </button>
            <button
              type="button"
              class="secondary copy"
              :aria-label="`Copy the output of ${run.command}`"
              @click="copy(run)"
            >
              {{ copiedRunId === run.runId ? 'Copied' : 'Copy' }}
            </button>
          </div>
        </div>
        <AnsiOutput v-if="run.output !== ''" :text="run.output" />
        <p v-if="run.exit !== null" class="exit">{{ exitLine(run) }}</p>
        <p v-else class="exit running">running…</p>
      </article>
    </div>
    <form class="composer" @submit.prevent="send">
      <input
        v-model="command"
        type="text"
        class="input"
        :disabled="running"
        placeholder="Type a command…"
        aria-label="Command to run"
        autocapitalize="off"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
      />
      <button type="submit" class="send" :disabled="running || command.trim() === ''">Run</button>
    </form>
  </section>
</template>

<style scoped>
.runner {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.toolbar {
  flex: none;
  display: flex;
  gap: 0.75rem;
  align-items: center;
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--border);
}

h1 {
  font-size: 1.1rem;
  margin: 0;
}

.scrollback {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.empty {
  color: var(--muted);
  margin: 0;
}

.run {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.head {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  justify-content: space-between;
}

.command {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
  color: var(--fg);
  word-break: break-word;
  min-width: 0;
}

.prompt {
  color: var(--accent);
  user-select: none;
}

.actions {
  flex: none;
  display: flex;
  gap: 0.4rem;
}

.actions button {
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
}

.exit {
  margin: 0;
  font-size: 0.75rem;
  color: var(--muted);
}

.exit.running {
  color: var(--accent);
}

.composer {
  flex: none;
  display: flex;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  padding-bottom: calc(0.6rem + env(safe-area-inset-bottom));
  border-top: 1px solid var(--border);
}

.input {
  flex: 1;
  min-width: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9rem;
}

.send {
  flex: none;
}
</style>
