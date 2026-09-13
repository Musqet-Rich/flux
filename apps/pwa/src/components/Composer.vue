<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import type { ReplyTarget } from '../composables/useMessageReply.ts';
import { useAutoGrow } from '../composables/useAutoGrow.ts';
import { useCommandHistory } from '../composables/useCommandHistory.ts';
import { useFileDrop } from '../composables/useFileDrop.ts';
import type { Store } from '../store/create-store.ts';
import type { PendingComment } from '../store/pending-comments.ts';
import ComposerTrays from './ComposerTrays.vue';
import { enterKey } from './enter-key.ts';
import Icon from './Icon.vue';

// The message box at the foot of the session screen, with what goes with the next message in
// the rows above it (ComposerTrays): the comments waiting for it (the parent derives them from
// the log it owns), the files attached to it (a + button, a drop on the bottom bar, or a paste)
// and, when the operator picked Reply on a bubble, the message being answered. The draft, text
// and files, lives in the store so leaving the session keeps it. Sends through the store, which
// reports failures; a failed send keeps the draft and the reply. Says when it `resized`: the
// box growing a line, a reply row, the tray, chips or the skill list all take their room from
// the timeline above, which the screen then keeps at its tail.

const props = defineProps<{
  store: Store;
  session: string;
  comments: PendingComment[];
  reply: ReplyTarget | null;
}>();
const emit = defineEmits<{ sent: []; unreply: []; resized: [] }>();

const draft = computed(() => props.store.composer(props.session));
const sending = ref(false);
const box = ref<HTMLTextAreaElement | null>(null);
const root = ref<HTMLElement | null>(null);
const picker = ref<HTMLInputElement | null>(null);
// Every file must be on the box before the message that names them goes.
const uploading = computed(() => draft.value.attachments.some((a) => a.status !== 'ready'));
const blank = computed(() => draft.value.text.trim() === '');
// The box is a line tall and grows with the text to ten lines (useAutoGrow).
useAutoGrow(box, () => draft.value.text);
// The screen's focus chord reaches the box through this (SessionView, useFocusChord).
defineExpose({ box });
// Any change of height, whatever inside it caused it.
let observer: ResizeObserver | null = null;
onMounted(() => {
  observer = new ResizeObserver(() => emit('resized'));
  if (root.value !== null) observer.observe(root.value);
});
onUnmounted(() => {
  observer?.disconnect();
});

const add = (files: File[]): void => {
  props.store.attach(props.session, files);
};
// The status bar is the other half of the bottom bar; it belongs to Shell, hence the lookup.
const bar = (): (Element | null)[] => [root.value, document.querySelector('footer.bar')];
const drop = useFileDrop(bar, add);

const pick = (event: Event): void => {
  const input = event.target instanceof HTMLInputElement ? event.target : null;
  add(Array.from(input?.files ?? []));
  if (input !== null) input.value = '';
};
// Files on the clipboard become attachments; a text paste is the browser's as before.
const paste = (event: Event): void => {
  const files = drop.filesOf(event);
  if (files.length === 0) return;
  event.preventDefault();
  add(files);
};

// Picking Reply is the start of typing, so the box takes focus.
watch(
  () => props.reply,
  (reply) => {
    if (reply !== null) box.value?.focus();
  },
);

const send = async (): Promise<void> => {
  const text = draft.value.text.trim();
  if (text === '' || sending.value || uploading.value) return;
  recall.done();
  sending.value = true;
  emit('sent');
  const ok = await props.store.send(props.session, text, props.reply?.seq);
  sending.value = false;
  if (!ok) return;
  if (props.reply !== null) emit('unreply');
};

const remove = (commentId: string): void => {
  void props.store.removeComment(props.session, commentId);
};

// Slash-command autocomplete: while the message is a single `/token` (no space yet), suggest the
// box's skill names that start with what is typed. A daemon without skills leaves the list empty,
// so nothing shows and the composer behaves as before. The list is fetched once on mount.
onMounted(() => {
  void props.store.refreshSkills();
});

const dismissed = ref(false);
const active = ref(0);

const query = computed((): string | null => {
  const text = draft.value.text;
  if (!text.startsWith('/')) return null;
  const rest = text.slice(1);
  return /\s/u.test(rest) ? null : rest;
});

const suggestions = computed((): string[] => {
  if (query.value === null) return [];
  const lower = query.value.toLowerCase();
  return (props.store.state.skills ?? [])
    .map((skill) => skill.name)
    .filter((name) => name.toLowerCase().startsWith(lower));
});

const suggestOpen = computed(() => suggestions.value.length > 0 && !dismissed.value);

// A recalled message that is itself a slash command keeps the list closed, or the next Up would
// move its highlight instead of going on back, and an Enter pick it: the text the history has
// put in the box, noted as each arrow lands and cleared at the next change of the query, so the
// same command typed by hand later is a query like any other. A Down past the newest puts the
// draft back, and a list that draft had was dismissed (or the Up would have gone to it), so it
// stays that way.
let recalled: string | null = null;
watch(query, () => {
  dismissed.value = draft.value.text === recalled;
  recalled = null;
  active.value = 0;
});

const choose = (name: string): void => {
  draft.value.text = `/${name} `;
  dismissed.value = true;
  box.value?.focus();
};

// Arrow keys move the highlight, a bare Enter takes it, Escape dismisses — only while the list
// is open, and true when the key was taken. A bare Enter takes the skill even when it is the
// device's send key (the next one sends); any chord goes to `key` as usual.
const nav = (event: KeyboardEvent): boolean => {
  if (!suggestOpen.value) return false;
  const count = suggestions.value.length;
  if (event.key === 'ArrowDown') active.value = (active.value + 1) % count;
  else if (event.key === 'ArrowUp') active.value = (active.value - 1 + count) % count;
  else if (event.key === 'Escape') dismissed.value = true;
  else if (enterKey.chord(event) === 'enter') {
    const name = suggestions.value[active.value];
    if (name !== undefined) choose(name);
  } else return false;
  event.preventDefault();
  return true;
};

// Up and Down at the edge of the text recall the session's past messages (useCommandHistory),
// after the slash list has had the arrows and before the send key has the Enter.
const recall = useCommandHistory(
  () => props.store.state.logs[props.session]?.events ?? [],
  () => draft.value,
  box,
);

// Which Enter sends is the device's choice (enter-key.ts); the rest break the line.
const ready = computed(() => !blank.value && !sending.value && !uploading.value);
const key = (event: KeyboardEvent): void => {
  if (nav(event)) return;
  if (recall.key(event)) {
    recalled = recall.shown() ?? draft.value.text;
    return;
  }
  if (enterKey.keydown(props.store.state.sendKey, ready.value, event, box.value)) void send();
};
const lineBreak = (event: InputEvent): void => {
  if (enterKey.lineBreak(props.store.state.sendKey, ready.value, event, box.value)) void send();
};
const sendHint = computed(
  () => `Send (${enterKey.label(props.store.state.sendKey, enterKey.apple)})`,
);
</script>

<template>
  <div ref="root" class="composer" :class="{ over: drop.over.value }">
    <ComposerTrays
      :comments="comments"
      :reply="reply"
      :attachments="draft.attachments"
      @remove-comment="remove"
      @unreply="$emit('unreply')"
      @remove-attachment="store.removeAttachment(session, $event)"
      @retry-attachment="store.retryAttachment(session, $event)"
    />
    <ul v-if="suggestOpen" class="slash-suggest" role="listbox">
      <li
        v-for="(name, index) in suggestions"
        :key="name"
        class="slash-option"
        :class="{ active: index === active }"
        role="option"
        :aria-selected="index === active"
        @mousedown.prevent="choose(name)"
      >
        /{{ name }}
      </li>
    </ul>
    <form class="row" @submit.prevent="send">
      <input ref="picker" type="file" multiple class="picker" aria-hidden="true" @change="pick" />
      <button
        type="button"
        class="secondary icon-only attach"
        aria-label="Attach files"
        title="Attach files"
        @click="picker?.click()"
      >
        <Icon name="attach" />
      </button>
      <textarea
        ref="box"
        v-model="draft.text"
        rows="1"
        placeholder="Message the agent"
        @keydown="key"
        @beforeinput="lineBreak"
        @paste="paste"
      />
      <button
        type="submit"
        class="icon-only send"
        aria-label="Send"
        :title="sendHint"
        :disabled="!ready"
      >
        <Icon name="send" />
      </button>
    </form>
  </div>
</template>

<style scoped>
.composer {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--border);
  background: var(--panel);
}

.row {
  display: flex;
  gap: 0.5rem;
  align-items: flex-end;
}

.picker {
  display: none;
}

/* Sized by useAutoGrow, so the base min-height and the drag handle are off. */
.row textarea {
  min-height: 0;
  resize: none;
}

.attach,
.send {
  flex: none;
  padding: 0.55rem 0.7rem;
}

.slash-suggest {
  list-style: none;
  margin: 0;
  padding: 0.25rem;
  max-height: 12rem;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--panel-2);
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.slash-option {
  padding: 0.35rem 0.5rem;
  border-radius: var(--radius);
  font-family: var(--font-code);
  font-size: 0.85rem;
  cursor: pointer;
}

.slash-option.active,
.slash-option:hover {
  background: var(--accent-soft, var(--panel));
}
</style>
