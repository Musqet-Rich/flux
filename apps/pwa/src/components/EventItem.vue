<script setup lang="ts">
import type { FluxEvent, KnownEvent } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';
import { computed, ref } from 'vue';

// One entry of the session timeline. Every event type renders as one of four shapes so the
// template stays a switch on `kind`; the detail (tool input/output) opens on tap.

interface View {
  kind: 'user' | 'assistant' | 'tool' | 'note';
  text: string;
  detail: string | null;
  tone: 'ok' | 'warn' | 'error' | null;
}

const props = defineProps<{ event: FluxEvent }>();
const expanded = ref(false);

const json = (value: unknown): string | null =>
  value === undefined ? null : JSON.stringify(value, null, 2);

const money = (usd: number | undefined): string =>
  usd === undefined ? '' : ` · $${usd.toFixed(3)}`;

const note = (text: string, tone: View['tone'] = null): View => ({
  kind: 'note',
  text,
  detail: null,
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

// `raw` and any type this build does not know (protocol.md § 8) show their name with the payload
// behind a tap, so a newer box never leaves a blank line in the timeline.
const opaque = (type: string, payload: unknown): View => ({
  kind: 'tool',
  text: `${type} event`,
  detail: json(payload),
  tone: null,
});

const describe = (event: FluxEvent): View => {
  if (!fluxEvent.isKnown(event)) return opaque(event.type, event.payload);
  switch (event.type) {
    case 'raw':
      return opaque(event.type, event.payload.data);
    case 'msg.user':
      return { kind: 'user', text: event.payload.text, detail: null, tone: null };
    case 'msg.assistant':
      return { kind: 'assistant', text: event.payload.text, detail: null, tone: null };
    case 'tool.start':
      return {
        kind: 'tool',
        text: event.payload.summary,
        detail: json(event.payload.input),
        tone: null,
      };
    case 'tool.end':
      return {
        kind: 'tool',
        text: event.payload.summary,
        detail: json(event.payload.output),
        tone: event.payload.ok ? 'ok' : 'error',
      };
    default:
      return describeNote(event);
  }
};

const view = computed(() => describe(props.event));
const toggle = (): void => {
  expanded.value = !expanded.value;
};
</script>

<template>
  <article class="item" :class="[view.kind, view.tone]">
    <pre v-if="view.kind === 'user' || view.kind === 'assistant'" class="text">{{ view.text }}</pre>
    <template v-else-if="view.kind === 'tool'">
      <button type="button" class="summary" :disabled="view.detail === null" @click="toggle">
        {{ view.text }}
      </button>
      <pre v-if="expanded && view.detail !== null" class="detail">{{ view.detail }}</pre>
    </template>
    <span v-else class="note">{{ view.text }}</span>
  </article>
</template>

<style scoped>
.item {
  max-width: 100%;
}

.user,
.assistant {
  padding: 0.6rem 0.8rem;
  border-radius: var(--radius);
  max-width: 85%;
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

.text {
  font: inherit;
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
</style>
