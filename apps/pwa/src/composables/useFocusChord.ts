import type { Ref } from 'vue';
import { onMounted, onUnmounted, watch } from 'vue';

import { focusChord } from '../components/focus-chord.ts';

// The focus chord (components/focus-chord.ts) puts the caret at the end of `box`, from
// anywhere on the screen that has it. Listens on the window while the owner is mounted, so
// the chord is the composer's on the session screen and the first message's on the New
// screen. A box that is disabled (the New screen while it creates) cannot take the focus,
// and the key is left. The key is taken only when the box takes it, so elsewhere the
// browser keeps whatever it does with the chord. The box's title is `name (⌃⌥M)`, in the
// device keyboard's terms, so a hover says the chord; set here as the box comes (the composer
// is main's alone, and the screen may be on a subagent's chat), since the two boxes want the
// same thing and Composer is at its import limit.

export const useFocusChord = (box: Ref<HTMLTextAreaElement | null>, name: string): void => {
  const onKey = (event: KeyboardEvent): void => {
    const el = box.value;
    if (el === null || el.disabled || !focusChord.matches(event)) return;
    event.preventDefault();
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  };
  const title = `${name} (${focusChord.label(focusChord.apple)})`;
  watch(
    box,
    (el) => {
      if (el !== null) el.title = title;
    },
    { immediate: true },
  );
  onMounted(() => {
    window.addEventListener('keydown', onKey);
  });
  onUnmounted(() => {
    window.removeEventListener('keydown', onKey);
  });
};
