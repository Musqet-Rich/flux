<script setup lang="ts">
import type { Attachment, FluxEvent, KnownEvent } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';
import type { VNode } from 'vue';
import { computed, ref } from 'vue';

import { renderMarkdown } from '../markdown/render-markdown.ts';
import MessageAttachments from './MessageAttachments.vue';
import MessageMenu from './MessageMenu.vue';

// One entry of the session timeline. Every event type renders as one of nine shapes so the
// template stays a switch on `kind`; the detail (tool input/output) opens on tap, a `link`
// opens in a new tab, a `warning` keeps its text (hook stderr) behind a disclosure, a
// `divider` rules across the timeline where the agent's context was cleared, a `task` is a
// note that opens that subagent's chat, and a `report` keeps the subagent's final report (what
// the parent actually read) behind a disclosure, rendered as Markdown like any reply. A message
// bubble carries a menu (MessageMenu) and, when it answers an earlier message, that message's
// first line as a chip (`quote`, looked up by the parent) that scrolls to it.

interface View {
  kind: 'user' | 'assistant' | 'tool' | 'note' | 'link' | 'warning' | 'divider' | 'task' | 'report';
  text: string;
  // The value behind the tap, stringified lazily; `undefined` means there is nothing to open.
  detail: unknown;
  tone: 'ok' | 'warn' | 'error' | null;
  href?: string;
  // The Agent call a `task` row opens.
  task?: string;
  // The message a `user` row answers.
  replyTo?: number;
  // The files sent with a `user` row (ADR 0020); `thumbs` has the fetched images by id.
  attachments?: Attachment[];
}

const props = withDefaults(
  defineProps<{ event: FluxEvent; quote?: string | null; thumbs?: Record<string, string> }>(),
  { quote: null, thumbs: () => ({}) },
);
defineEmits<{ task: [toolUseId: string]; reply: [seq: number]; jump: [seq: number] }>();
const expanded = ref(false);

// A tool output or a raw agent line can run to hundreds of KB; the detail is only stringified
// once opened and never past this many characters, so a long event cannot stall the timeline.
const detailCap = 64 * 1024;

const json = (value: unknown): string => {
  const text = JSON.stringify(value, null, 2);
  return text.length > detailCap ? `${text.slice(0, detailCap)}\n… truncated at 64 KiB` : text;
};

const money = (usd: number | undefined): string =>
  usd === undefined ? '' : ` · $${usd.toFixed(3)}`;

const note = (text: string, tone: View['tone'] = null): View => ({
  kind: 'note',
  text,
  detail: undefined,
  tone,
});

// Lifecycle, operator-interaction and code events all render as a one-line note.
const describeNote = (event: KnownEvent): View => {
  switch (event.type) {
    case 'session.created':
      return note(`Session started on ${event.payload.branch}`);
    case 'session.state':
      return note(
        `Agent ${event.payload.state.replace('_', ' ')}`,
        event.payload.state === 'ended' ? 'warn' : null,
      );
    case 'session.renamed':
      return note(`Renamed to ${event.payload.title}`);
    case 'session.cleared':
      return { kind: 'divider', text: 'Context cleared', detail: undefined, tone: null };
    case 'turn.ended':
      return note(`Turn ended${money(event.payload.costUsd)}`);
    case 'rate_limit':
      return note('Rate limit changed');
    case 'ask':
      return note(`Asked: ${event.payload.question}`, 'warn');
    case 'ask.answered':
      return note(`Answered: ${event.payload.answer}`);
    case 'notify':
      return note(event.payload.summary, event.payload.level === 'blocked' ? 'error' : 'ok');
    case 'files.changed':
      return note(`${event.payload.files.length} file(s) changed`);
    case 'comment.added':
      return note(`Comment on ${event.payload.ref.path}: ${event.payload.text}`);
    case 'comment.removed':
      return note('Comment removed');
    case 'comment.sent':
      return note(`${event.payload.commentIds.length} comment(s) sent`);
    default:
      return note(`${event.type} event`);
  }
};

// Claude Code's own signals (protocol.md § 5): a task around a tool call, a PR the agent
// opened, a hook that failed. Null for every other type.
const describeSignal = (event: KnownEvent): View | null => {
  switch (event.type) {
    case 'task.started': {
      const { background, description, agentType, toolUseId } = event.payload;
      const who = agentType === undefined ? '' : `${agentType} · `;
      const text = `${background ? 'Background task' : 'Task'}: ${who}${description}`;
      return { kind: 'task', text, detail: undefined, tone: null, task: toolUseId };
    }
    case 'task.ended': {
      const { status, summary, tokens } = event.payload;
      const used = tokens === undefined ? '' : ` · ${(tokens / 1000).toFixed(1)}k tokens`;
      const detail = summary === '' ? undefined : summary;
      const tone = status === 'completed' ? null : 'warn';
      return { kind: 'report', text: `Task ${status}${used}`, detail, tone };
    }
    case 'pr.published': {
      const { identifier, action, repo, url } = event.payload;
      const name = identifier === '' ? 'Pull request' : `Pull request #${identifier}`;
      return {
        kind: 'link',
        text: `${name} ${action} · ${repo}`,
        detail: undefined,
        tone: 'ok',
        href: url,
      };
    }
    case 'hook.failed': {
      const { hookName, exitCode, stderr } = event.payload;
      const exit = exitCode === undefined ? '' : ` (exit ${exitCode})`;
      const detail = stderr === '' ? undefined : stderr;
      return { kind: 'warning', text: `Hook ${hookName} failed${exit}`, detail, tone: 'warn' };
    }
    default:
      return null;
  }
};

// Any type this build does not know (protocol.md § 8) shows its name with the payload behind a
// tap, so a newer box never leaves a blank line in the timeline. `raw` renders the same way,
// though `SessionView` keeps it out of the timeline.
const opaque = (type: string, payload: unknown): View => ({
  kind: 'tool',
  text: `${type} event`,
  detail: payload,
  tone: null,
});

const describe = (event: FluxEvent): View => {
  if (!fluxEvent.isKnown(event)) return opaque(event.type, event.payload);
  switch (event.type) {
    case 'raw':
      return opaque(event.type, event.payload);
    case 'msg.user':
      return {
        kind: 'user',
        text: event.payload.text,
        detail: undefined,
        tone: null,
        ...(event.payload.replyTo === undefined ? {} : { replyTo: event.payload.replyTo }),
        ...(event.payload.attachments === undefined
          ? {}
          : { attachments: event.payload.attachments }),
      };
    case 'msg.assistant':
      return { kind: 'assistant', text: event.payload.text, detail: undefined, tone: null };
    case 'tool.start':
      return {
        kind: 'tool',
        text: event.payload.summary,
        detail: event.payload.input,
        tone: null,
      };
    case 'tool.end':
      return {
        kind: 'tool',
        text: event.payload.summary,
        detail: event.payload.output,
        tone: event.payload.ok ? 'ok' : 'error',
      };
    default:
      return describeSignal(event) ?? describeNote(event);
  }
};

const view = computed(() => describe(props.event));
// Both sides write Markdown (the operator pastes agent output back and uses tables and code
// too). A functional component so the VNode tree is built inside its own render, not in the
// template.
const Markdown = (): VNode => renderMarkdown(view.value.text);
const Report = (): VNode => renderMarkdown(String(view.value.detail));
const hasDetail = computed(() => view.value.detail !== undefined);
const detail = computed(() => (expanded.value && hasDetail.value ? json(view.value.detail) : null));
const toggle = (): void => {
  expanded.value = !expanded.value;
};
const isMessage = computed(() => view.value.kind === 'user' || view.value.kind === 'assistant');
// The chip shows the quoted message's first non-blank line only; a source not in the log
// (an older device's partial sync) still gets a chip that says what the row is.
const quoteLine = computed(
  () => props.quote?.split('\n').find((line) => line.trim() !== '') ?? 'earlier message',
);
</script>

<template>
  <article class="item" :class="[view.kind, view.tone]" :data-seq="event.seq">
    <MessageMenu
      v-if="isMessage"
      :text="view.text"
      :side="view.kind === 'user' ? 'left' : 'right'"
      @reply="$emit('reply', event.seq)"
    />
    <button
      v-if="view.replyTo !== undefined"
      type="button"
      class="quote"
      @click="$emit('jump', view.replyTo)"
    >
      ↩ {{ quoteLine }}
    </button>
    <template v-if="isMessage">
      <Markdown />
      <MessageAttachments
        v-if="view.attachments !== undefined"
        :attachments="view.attachments"
        :thumbs="thumbs"
      />
    </template>
    <template v-else-if="view.kind === 'tool'">
      <button type="button" class="summary" :disabled="!hasDetail" @click="toggle">
        {{ view.text }}
      </button>
      <pre v-if="detail !== null" class="detail">{{ detail }}</pre>
    </template>
    <a
      v-else-if="view.kind === 'link'"
      class="note link"
      :href="view.href"
      target="_blank"
      rel="noopener noreferrer"
      >{{ view.text }}</a
    >
    <details v-else-if="view.kind === 'warning' && hasDetail" class="disclosure">
      <summary class="note">{{ view.text }}</summary>
      <pre class="detail stderr">{{ view.detail }}</pre>
    </details>
    <details v-else-if="view.kind === 'report' && hasDetail" class="disclosure">
      <summary class="note">{{ view.text }}</summary>
      <div class="detail report"><Report /></div>
    </details>
    <button
      v-else-if="view.kind === 'task'"
      type="button"
      class="note task"
      @click="$emit('task', view.task ?? '')"
    >
      {{ view.text }} ›
    </button>
    <span v-else-if="view.kind === 'divider'" class="rule" role="separator">{{ view.text }}</span>
    <span v-else class="note">{{ view.text }}</span>
  </article>
</template>

<style scoped>
.item {
  max-width: 100%;
  /* A flex child's min-width is its content by default, so one unbreakable token (a quoted
     grep pattern, a long path) would widen the whole timeline past the viewport. */
  min-width: 0;
}

.user,
.assistant {
  position: relative;
  padding: 0.6rem 0.8rem;
  border-radius: var(--radius);
  max-width: 85%;
}

.user {
  padding-left: 2rem;
}

.assistant {
  padding-right: 2rem;
}

.quote {
  display: block;
  width: 100%;
  margin-bottom: 0.4rem;
  padding: 0.25rem 0.5rem;
  border-left: 2px solid currentColor;
  border-radius: 0;
  background: rgb(0 0 0 / 15%);
  color: inherit;
  opacity: 0.85;
  font-size: 0.8rem;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user {
  align-self: flex-end;
  background: var(--accent);
  color: var(--accent-fg);
}

.assistant {
  align-self: flex-start;
  background: var(--panel-2);
}

/* Code panels and table headers in the user bubble sit on the accent colour, so the panel tint
   is a shade of it rather than the assistant's panel token. Code inside a fence keeps the
   global reset, or it would be tinted twice. */
.user :deep(.markdown code),
.user :deep(.markdown pre),
.user :deep(.markdown th) {
  background: rgb(0 0 0 / 15%);
}

.user :deep(.markdown pre code) {
  background: transparent;
}

.user :deep(.markdown pre),
.user :deep(.markdown th),
.user :deep(.markdown td) {
  border-color: rgb(0 0 0 / 25%);
}

.user :deep(.markdown a),
.user :deep(.markdown blockquote) {
  color: inherit;
}

.tool {
  align-self: stretch;
}

.summary {
  background: transparent;
  color: var(--muted);
  padding: 0.15rem 0;
  text-align: left;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
  width: 100%;
  overflow-wrap: anywhere;
}

.summary:disabled {
  opacity: 1;
}

.ok .summary {
  color: var(--ok);
}

.error .summary,
.error .note {
  color: var(--danger);
}

.warn .note {
  color: var(--warn);
}

.detail {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.5rem;
  max-height: 16rem;
  overflow: auto;
}

.note {
  align-self: center;
  color: var(--muted);
  font-size: 0.8rem;
}

.ok .link {
  color: var(--ok);
}

.divider {
  align-self: stretch;
}

.rule {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--muted);
  font-size: 0.8rem;
}

.rule::before,
.rule::after {
  content: '';
  flex: 1;
  border-top: 1px solid var(--border);
}

.disclosure {
  align-self: stretch;
  text-align: center;
}

.disclosure summary {
  cursor: pointer;
}

.stderr {
  text-align: left;
  font-size: 0.8rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.report {
  text-align: left;
  font-size: 0.9rem;
}

.task {
  background: transparent;
  padding: 0.15rem 0.4rem;
  color: var(--accent);
}
</style>
