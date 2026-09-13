import type { FluxEvent, KnownEvent } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';

import type { EventView } from './event-view.ts';

// What one timeline event looks like (EventItem.vue draws it): every event type becomes one of
// the nine `kind`s of EventView, with its one line of text, what a tap opens, its tone, and for
// Claude Code's own signals (a task, a PR, a failed hook, a compaction) the icon that marks the
// row (ADR 0029). Pure, so the mapping is testable without mounting the component. Chains of
// `if` rather than a switch on `type`: the type-aware exhaustiveness rule wants every one of the
// union's members listed per switch, and a note for "the rest" is the point here.

const money = (usd: number | undefined): string =>
  usd === undefined ? '' : ` · $${usd.toFixed(3)}`;

// Token counts on the compaction divider, read compactly: 60065 → '60k', 6202 → '6.2k' (one
// decimal below 10k, none at or above).
const compactTokens = (n: number): string => {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
};

const note = (text: string, tone: EventView['tone'] = null): EventView => ({
  kind: 'note',
  text,
  detail: undefined,
  tone,
});

// A manager agent acted on this session (ADR 0025): its own system row, styled like other
// lifecycle notes. `open` lands on the session the manager created, the rest on the one it acted
// on, so the operator can always see what the manager did to which session.
type ManagerActed = Extract<KnownEvent, { type: 'manager.acted' }>['payload'];
const managerNote = (payload: ManagerActed): EventView => {
  const { action, target, detail } = payload;
  const head =
    action === 'open'
      ? `opened session ${target}`
      : action === 'send'
        ? `sent to ${target}`
        : action === 'close'
          ? `archived ${target}`
          : `read ${target}`;
  const tail = action === 'send' && detail !== '' ? `: ${detail}` : '';
  return note(`Manager · ${head}${tail}`);
};

// The session's own lifecycle.
const lifecycleNote = (event: KnownEvent): EventView | null => {
  if (event.type === 'session.created') return note(`Session started on ${event.payload.branch}`);
  if (event.type === 'session.state') {
    const { state } = event.payload;
    return note(`Agent ${state.replace('_', ' ')}`, state === 'ended' ? 'warn' : null);
  }
  if (event.type === 'session.renamed') return note(`Renamed to ${event.payload.title}`);
  if (event.type === 'session.head') return note(`Now on ${event.payload.head}`);
  if (event.type === 'session.cleared') {
    return { kind: 'divider', text: 'Context cleared', detail: undefined, tone: null };
  }
  if (event.type === 'turn.ended') return note(`Turn ended${money(event.payload.costUsd)}`);
  if (event.type === 'rate_limit') return note('Rate limit changed');
  if (event.type === 'agent.spec') {
    const { model, effort } = event.payload;
    return note(`Running ${effort === undefined ? model : `${model}:${effort}`}`);
  }
  return null;
};

// The operator and the agent talking past the chat, and the code review that rides with it.
const interactionNote = (event: KnownEvent): EventView | null => {
  if (event.type === 'ask') return note(`Asked: ${event.payload.question}`, 'warn');
  if (event.type === 'ask.answered') return note(`Answered: ${event.payload.answer}`);
  if (event.type === 'notify') {
    return note(event.payload.summary, event.payload.level === 'blocked' ? 'error' : 'ok');
  }
  if (event.type === 'files.changed') return note(`${event.payload.files.length} file(s) changed`);
  if (event.type === 'comment.added') {
    return note(`Comment on ${event.payload.ref.path}: ${event.payload.text}`);
  }
  if (event.type === 'comment.removed') return note('Comment removed');
  if (event.type === 'comment.sent') {
    return note(`${event.payload.commentIds.length} comment(s) sent`);
  }
  if (event.type === 'manager.acted') return managerNote(event.payload);
  return null;
};

// Lifecycle, operator-interaction and code events all render as a one-line note.
const describeNote = (event: KnownEvent): EventView =>
  lifecycleNote(event) ?? interactionNote(event) ?? note(`${event.type} event`);

type CompactBoundary = Extract<KnownEvent, { type: 'compact.boundary' }>['payload'];
const compaction = (payload: CompactBoundary): EventView => {
  const { preTokens, postTokens, durationMs, result } = payload;
  if (result !== 'success') {
    return {
      kind: 'divider',
      text: 'Compaction failed',
      detail: undefined,
      tone: 'warn',
      icon: 'warning',
    };
  }
  const secs = Math.round(durationMs / 1000);
  const delta = `${compactTokens(preTokens)} → ${compactTokens(postTokens)} tokens`;
  return {
    kind: 'divider',
    text: `Context compacted · ${delta} · ${secs}s`,
    detail: undefined,
    tone: null,
    icon: 'compact',
  };
};

// Claude Code's own signals (protocol.md § 5): a task around a tool call, a PR the agent
// opened, a hook that failed, a compaction. Null for every other type.
const describeSignal = (event: KnownEvent): EventView | null => {
  if (event.type === 'task.started') {
    const { background, description, agentType, toolUseId } = event.payload;
    const who = agentType === undefined ? '' : `${agentType} · `;
    const text = `${background ? 'Background task' : 'Task'}: ${who}${description}`;
    return { kind: 'task', text, detail: undefined, tone: null, task: toolUseId, icon: 'task' };
  }
  if (event.type === 'task.ended') {
    const { status, summary, tokens } = event.payload;
    const used = tokens === undefined ? '' : ` · ${(tokens / 1000).toFixed(1)}k tokens`;
    const detail = summary === '' ? undefined : summary;
    const tone = status === 'completed' ? null : 'warn';
    const icon = status === 'completed' ? 'succeeded' : 'failed';
    return { kind: 'report', text: `Task ${status}${used}`, detail, tone, icon };
  }
  if (event.type === 'pr.published') {
    const { identifier, action, repo, url } = event.payload;
    const name = identifier === '' ? 'Pull request' : `Pull request #${identifier}`;
    const text = `${name} ${action} · ${repo}`;
    return { kind: 'link', text, detail: undefined, tone: 'ok', href: url, icon: 'pullRequest' };
  }
  if (event.type === 'hook.failed') {
    const { hookName, exitCode, stderr } = event.payload;
    const exit = exitCode === undefined ? '' : ` (exit ${exitCode})`;
    const detail = stderr === '' ? undefined : stderr;
    const text = `Hook ${hookName} failed${exit}`;
    return { kind: 'warning', text, detail, tone: 'warn', icon: 'warning' };
  }
  if (event.type === 'compact.boundary') return compaction(event.payload);
  return null;
};

// Any type this build does not know (protocol.md § 8) shows its name with the payload behind a
// tap, so a newer box never leaves a blank line in the timeline. `raw` renders the same way,
// though `useSessionTimeline` keeps it out of the timeline.
const opaque = (type: string, payload: unknown): EventView => ({
  kind: 'tool',
  text: `${type} event`,
  detail: payload,
  tone: null,
});

export const describeEvent = (event: FluxEvent): EventView => {
  if (!fluxEvent.isKnown(event) || event.type === 'raw') return opaque(event.type, event.payload);
  if (event.type === 'msg.user') {
    const { text, replyTo, attachments } = event.payload;
    return {
      kind: 'user',
      text,
      detail: undefined,
      tone: null,
      ...(replyTo === undefined ? {} : { replyTo }),
      ...(attachments === undefined ? {} : { attachments }),
    };
  }
  if (event.type === 'msg.assistant') {
    return { kind: 'assistant', text: event.payload.text, detail: undefined, tone: null };
  }
  if (event.type === 'tool.start') {
    const { summary, input } = event.payload;
    return { kind: 'tool', text: summary, detail: input, tone: null };
  }
  if (event.type === 'tool.end') {
    const { summary, output, ok } = event.payload;
    return { kind: 'tool', text: summary, detail: output, tone: ok ? 'ok' : 'error' };
  }
  return describeSignal(event) ?? describeNote(event);
};
