import type { FluxEvent } from '@flux/protocol';
import { fluxEvent } from '@flux/protocol';
import type { Ref } from 'vue';
import { nextTick, onScopeDispose, watch } from 'vue';

// A shell's history on the message box: Up recalls the message the operator sent before, Up
// again the one before that, Down comes back, and Down past the newest restores what was being
// typed. The history is the session's own log, its top-level `msg.user` rows (one with a
// `parent` is the agent's prompt to a subagent, not the operator's), so it is the session's,
// not this device's, and survives a reload with nothing kept apart; the last hundred, a message
// the same as the one before it counted once, since a repeat is one thing to recall. A message
// another device sends while the operator is browsing shifts the count by one, so the next Up
// shows the entry again before going on. The arrows only recall from the edge of the text, Up
// with the caret before the first line break and Down after the last, so inside a longer draft
// they move the caret as ever; and what they put in the box is a draft like any other: an edit
// to it, or a send, whether or not the box takes it, ends the browsing, and the next Up starts
// again from the newest. The draft is the store's, kept per session, and browsing goes on over that very
// object: when the box moves to another session's draft, or the screen closes, an entry still
// in the old one unedited gives way to the draft it replaced, since that is what the store would
// keep. The caller runs `key` before the send key, and before it any list that takes the arrows,
// tells `done` when it sends, and keeps a recalled entry that is a slash command from its list.

const limit = 100;

// Oldest first, with consecutive repeats dropped before the cap, so a run of the same message
// does not fill it.
const history = (events: FluxEvent[]): string[] => {
  const texts: string[] = [];
  for (const event of events) {
    if (!fluxEvent.isKnown(event) || event.type !== 'msg.user' || event.parent !== undefined) {
      continue;
    }
    const { text } = event.payload;
    if (text !== texts.at(-1)) texts.push(text);
  }
  return texts.slice(-limit);
};

// Up from the first line of the text, Down from the last: the caret's side of the text holds
// no line break.
const atEdge = (box: HTMLTextAreaElement, up: boolean): boolean =>
  !(up ? box.value.slice(0, box.selectionStart) : box.value.slice(box.selectionEnd)).includes('\n');
// An arrow on its own: with a modifier it is the browser's (a ⇧ selects, a ⌘ jumps), and while
// an IME is composing it is the IME's, moving through its candidates.
const arrow = (event: KeyboardEvent): 'up' | 'down' | null => {
  if (event.isComposing) return null;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (event.key === 'ArrowUp') return 'up';
  return event.key === 'ArrowDown' ? 'down' : null;
};

// The store's draft for one session; the text is all this reads and writes.
interface Draft {
  text: string;
}

// A browse in progress: the draft it is over, how far back from the newest it stands, the text
// that draft held before, and the entry put in it, to tell an edit from it.
interface Browsing {
  held: Draft;
  back: number;
  stash: string;
  shown: string;
}

// The caret goes to the end after v-model has put the entry in the DOM.
const caretToEnd = (box: Ref<HTMLTextAreaElement | null>, value: string): void => {
  void nextTick(() => {
    box.value?.setSelectionRange(value.length, value.length);
  });
};

// The browse over the box's draft: none, or one in progress. Nothing of the DOM in here: `step`
// says what it put in the draft, and the caller puts the caret after it.
const browse = (draft: () => Draft) => {
  let browsing: Browsing | null = null;
  // Over the box's draft and unedited; otherwise the browse is over, and an entry left in a
  // draft unedited goes back to what the draft held.
  const live = (): boolean =>
    browsing !== null && browsing.held === draft() && browsing.held.text === browsing.shown;
  const leave = (): void => {
    if (browsing !== null && browsing.held.text === browsing.shown) {
      browsing.held.text = browsing.stash;
    }
    browsing = null;
  };
  // A step back or forward: past the oldest stays where it is, past the newest is the draft.
  // The text now in the box, or null when it did not change.
  const step = (entries: string[], up: boolean): string | null => {
    const held = draft();
    const current = browsing ?? { held, back: -1, stash: held.text, shown: held.text };
    const next = current.back + (up ? 1 : -1);
    if (next < 0) {
      leave();
      return held.text;
    }
    const entry = entries.at(-1 - next);
    if (entry === undefined) return null;
    current.back = next;
    current.shown = entry;
    current.held.text = entry;
    browsing = current;
    return entry;
  };
  // The entry in the box, null when not browsing; and a send, whether or not the box accepts
  // it, takes the entry as the message: nothing to put back.
  const shown = (): string | null => browsing?.shown ?? null;
  const done = (): void => {
    browsing = null;
  };
  return { live, leave, step, shown, done };
};

export const useCommandHistory = (
  events: () => FluxEvent[],
  draft: () => Draft,
  box: Ref<HTMLTextAreaElement | null>,
): { key: (event: KeyboardEvent) => boolean; shown: () => string | null; done: () => void } => {
  const current = browse(draft);
  // True when the key was taken.
  const key = (event: KeyboardEvent): boolean => {
    const el = box.value;
    const way = arrow(event);
    if (el === null || way === null) return false;
    const live = current.live();
    if (!live) current.leave();
    const up = way === 'up';
    if (!atEdge(el, up) || (!up && !live)) return false;
    const entries = history(events());
    if (entries.length === 0) return false;
    event.preventDefault();
    const text = current.step(entries, up);
    if (text !== null) caretToEnd(box, text);
    return true;
  };
  watch(draft, current.leave);
  onScopeDispose(current.leave);
  return { key, shown: current.shown, done: current.done };
};
