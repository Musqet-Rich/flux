<script setup lang="ts">
import type { FluxEvent } from '@flux/protocol';
import { computed } from 'vue';

import { fluxEvent } from '@flux/protocol';

import type { Store } from '../store/create-store.ts';
import { sessionPr } from '../store/session-pr.ts';
import SessionMenu from './SessionMenu.vue';

// The strip above the timeline: the branch, a small chip naming what the agent is running as
// `model:effort` from the log's latest `agent.spec` (ADR 0028; the harness alone until the agent
// has said, and on the chip's title after), a link to the session's PR once the log has a
// `pr.published`, Stop while the agent runs, Changes (with the latest changed-file count), and
// the session menu.

const props = defineProps<{
  store: Store;
  session: string;
  events: readonly FluxEvent[];
  branch: string;
  busy: boolean;
}>();
defineEmits<{ changes: []; files: []; interrupt: []; closed: [] }>();

const harnessLabel = (kind: string): string =>
  kind === 'claude' ? 'Claude Code' : kind === 'pi' ? 'Pi' : kind;
const harness = computed((): string => {
  const summary = props.store.state.sessions.find((s) => s.session === props.session);
  return summary === undefined ? '' : harnessLabel(summary.harness);
});
// The latest `agent.spec`, or null before the agent has said what it runs.
const spec = computed(() => {
  const last = props.events.findLast((e) => e.type === 'agent.spec');
  return last !== undefined && fluxEvent.isKnown(last) && last.type === 'agent.spec'
    ? last.payload
    : null;
});
// A model id on the chip loses the vendor prefix and a dated snapshot's date, `fable-5-1` for
// `claude-fable-5-1`, `haiku-4-5` for `claude-haiku-4-5-20251001` (a `[1m]` context suffix
// stays): on a phone-width toolbar a full id would push the effort, the part the chip exists to
// show, into the ellipsis. The whole id is on the title.
const shortModel = (model: string): string =>
  model.replace(/^claude-/u, '').replace(/-\d{8}(?=\[|$)/u, '');
const label = (model: string, effort: string | undefined): string =>
  effort === undefined ? model : `${model}:${effort}`;
// The running spec is what the chip is for; the harness is its stand-in until the agent has
// spoken, and rides on the chip's title after, since the toolbar has room for one of them.
const chip = computed((): string =>
  spec.value === null ? harness.value : label(shortModel(spec.value.model), spec.value.effort),
);
const chipTitle = computed((): string =>
  [harness.value, spec.value === null ? '' : label(spec.value.model, spec.value.effort)]
    .filter((part) => part !== '')
    .join(' · '),
);

const pr = computed(() => sessionPr(props.events));
const prLabel = computed(() =>
  pr.value?.identifier === '' ? 'PR' : `PR #${pr.value?.identifier}`,
);
// The count from the latest `files.changed` event, on the button so those events need not spam
// the timeline. `ChangesView` reads the same last event when its fresher `git.status` has not run.
const changedCount = computed(() => {
  const last = props.events.findLast((e) => e.type === 'files.changed');
  return last !== undefined && fluxEvent.isKnown(last) && last.type === 'files.changed'
    ? last.payload.files.length
    : 0;
});
</script>

<template>
  <div class="toolbar">
    <span class="ident">
      <span class="branch">{{ branch }}</span>
      <span v-if="chip !== ''" class="spec-chip" :title="chipTitle">{{ chip }}</span>
    </span>
    <a v-if="pr !== null" class="pr" :href="pr.url" target="_blank" rel="noopener noreferrer">{{
      prLabel
    }}</a>
    <button v-if="busy" type="button" class="secondary" @click="$emit('interrupt')">Stop</button>
    <button type="button" class="secondary" @click="$emit('files')">Files</button>
    <button type="button" class="secondary" @click="$emit('changes')">
      Changes ({{ changedCount }})
    </button>
    <SessionMenu :store="store" :session="session" @closed="$emit('closed')" />
  </div>
</template>

<style scoped>
.toolbar {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.5rem;
  align-items: center;
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--border);
}

/* The branch and the chip share whatever the buttons leave: a flex basis of zero, so they never
   push a button off a phone's width, and the row only wraps in the one state where the buttons
   alone are wider than the screen (a PR link and Stop beside Files, Changes and the menu),
   which drops the menu to a second line rather than clipping it. Inside, the chip is sized first
   and the branch takes what is left, down to nothing on a phone: a session's title defaults
   to its branch, so the tab already names it, while the chip is the only place what the agent
   runs shows. */
.ident {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.branch {
  flex: 1;
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spec-chip {
  flex: 0 1 auto;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.1rem 0.4rem;
  font-size: 0.75rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 14rem;
}

.pr {
  flex: none;
  color: var(--accent);
  font-size: 0.85rem;
  text-decoration: none;
  white-space: nowrap;
}

.toolbar > .secondary {
  flex: none;
  white-space: nowrap;
}

/* Only bites on a wrapped second line, where it keeps the menu at the right edge: on one line
   `.ident` has already grown into the free space, so there is none left for the margin. */
.toolbar > :last-child {
  margin-left: auto;
}
</style>
