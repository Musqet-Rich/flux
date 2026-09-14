<script setup lang="ts">
import type { FluxEvent } from '@flux/protocol';
import { computed } from 'vue';

import { useLogFold } from '../composables/useLogFold.ts';
import type { Store } from '../store/create-store.ts';
import { logFold } from '../store/log-fold.ts';
import { sessionPr } from '../store/session-pr.ts';
import { homePath } from './home-path.ts';
import Icon from './Icon.vue';
import SessionMenu from './SessionMenu.vue';

// The strip above the timeline: where the session is, as a shell prompt would put it, `~/code/flux
// (feat/x)`, the repository with the branch the worktree is on, the summary's `head` once the
// box has seen HEAD move (`session.head`) and the created branch before, and the worktree's
// own path as a hover hint on the title (a pointer's, not a phone's, so nothing depends on it);
// a small chip naming what the agent is running as `model:effort` from the log's latest
// `agent.spec` (ADR 0028; the harness alone until the agent has said, and on the chip's title
// after), a link to the session's PR once the log has a `pr.published`, Stop while the agent
// runs (Esc does the same, wired in SessionView), Files, Changes (with the latest changed-file
// count) and the session menu. The buttons are icons with their names on `aria-label`/`title`:
// the row has to fit a phone beside the place (ADR 0029).

const props = defineProps<{
  store: Store;
  session: string;
  events: readonly FluxEvent[];
  busy: boolean;
}>();
defineEmits<{ changes: []; files: []; interrupt: []; closed: [] }>();

const summary = computed(() => props.store.state.sessions.find((s) => s.session === props.session));
// The session id stands in until the list has the session (a reload straight onto it).
const repo = computed((): string =>
  summary.value === undefined
    ? props.session
    : homePath(summary.value.repo, props.store.state.home),
);
const branch = computed((): string => summary.value?.head ?? summary.value?.branch ?? '');
const whereTitle = computed((): string | undefined => {
  const s = summary.value;
  return s?.worktree === undefined
    ? undefined
    : `Worktree ${homePath(s.worktree, props.store.state.home)}`;
});

const harnessLabel = (kind: string): string =>
  kind === 'claude' ? 'Claude Code' : kind === 'pi' ? 'Pi' : kind;
const harness = computed((): string =>
  summary.value === undefined ? '' : harnessLabel(summary.value.harness),
);
// The latest `agent.spec`, or null before the agent has said what it runs.
const spec = useLogFold(() => props.events, logFold.latest('agent.spec'));
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

const pr = useLogFold(() => props.events, sessionPr);
const prLabel = computed(() =>
  pr.value?.identifier === '' ? 'PR' : `PR #${pr.value?.identifier}`,
);
const prNumber = computed(() => (pr.value?.identifier === '' ? '' : `#${pr.value?.identifier}`));
// The count from the latest `files.changed` event, on the button so those events need not spam
// the timeline. `ChangesView` reads the same last event when its fresher `git.status` has not run.
const changed = useLogFold(() => props.events, logFold.latest('files.changed'));
const changedCount = computed(() => changed.value?.files.length ?? 0);
const changesLabel = computed(() => `Changes (${changedCount.value})`);
</script>

<template>
  <div class="toolbar">
    <span class="ident">
      <span class="where" :title="whereTitle">
        <span class="repo">{{ repo }}</span>
        <span v-if="branch !== ''" class="branch"> ({{ branch }})</span>
      </span>
      <span v-if="chip !== ''" class="spec-chip" :title="chipTitle">{{ chip }}</span>
    </span>
    <a
      v-if="pr !== null"
      class="pr"
      :href="pr.url"
      target="_blank"
      rel="noopener noreferrer"
      :aria-label="prLabel"
      :title="prLabel"
    >
      <Icon name="pullRequest" />{{ prNumber }}
    </a>
    <button
      v-if="busy"
      type="button"
      class="secondary icon-only"
      aria-label="Stop"
      title="Stop the agent (Esc)"
      @click="$emit('interrupt')"
    >
      <Icon name="stop" />
    </button>
    <button
      type="button"
      class="secondary icon-only"
      aria-label="Files"
      title="Files"
      @click="$emit('files')"
    >
      <Icon name="files" />
    </button>
    <button
      type="button"
      class="secondary icon-only"
      :aria-label="changesLabel"
      :title="changesLabel"
      @click="$emit('changes')"
    >
      <Icon name="changes" /><span class="count">{{ changedCount }}</span>
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

/* The place and the chip share whatever the buttons leave: a flex basis of zero, so they never
   push a button off a phone's width, and the row only wraps in the one state where the buttons
   alone are wider than the screen (a PR link and Stop beside Files, Changes and the menu),
   which drops the menu to a second line rather than clipping it. Inside, the chip is sized first
   and the place takes what is left, down to nothing on a phone, the repository going before
   the branch: the branch is the part only this strip shows, since the tab's title is the one
   the session began on, while the chip is the only place what the agent runs shows. */
.ident {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.where {
  flex: 1;
  min-width: 0;
  display: flex;
  color: var(--muted);
  font-family: var(--font-code);
  font-size: 0.85rem;
  white-space: nowrap;
}

/* Both clip with an ellipsis, the repository first: the branch never shrinks, so it stays whole
   while the repository has anything left, and its max-width clips it only once it alone is
   wider than the row. The repository clips at its end (`~/co… (feat/x)`), losing the name
   before the `~/`: clipping the start needs a direction trick that shuffles the path's own
   punctuation, and the title has the whole of it. */
.repo,
.branch {
  overflow: hidden;
  text-overflow: ellipsis;
}

.repo {
  flex: 0 1 auto;
  min-width: 0;
}

.branch {
  flex: none;
  max-width: 100%;
  /* The leading space that sets it off from the repository. */
  white-space: pre;
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
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  color: var(--accent);
  font-size: 0.85rem;
  text-decoration: none;
  white-space: nowrap;
}

.count {
  font-size: 0.8rem;
  margin-left: 0.3rem;
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
