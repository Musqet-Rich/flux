import type { ComputedRef, Ref } from 'vue';
import { computed, onMounted, onUnmounted } from 'vue';

import { focusChord } from '../components/focus-chord.ts';

// The focus chord (components/focus-chord.ts) puts the caret at the end of `box`, from
// anywhere on the screen that has it, while `on` says the device has it (the switch picker
// not Off). Listens on the window while the owner is mounted, so the chord is the composer's
// on the session screen and the first message's on the New screen. A box that is disabled
// (the New screen while it creates) cannot take the focus, and the key is left. The key is
// taken only when the box takes it, so elsewhere the browser keeps whatever it does with the
// chord. Gives back the box's title, `name (⌃⌥M)` in the device keyboard's terms so a hover
// says the chord, or nothing when the chord is off (the box's label or placeholder says the
// rest).

export const useFocusChord = (
  box: Ref<HTMLTextAreaElement | null>,
  name: string,
  on: () => boolean,
): ComputedRef<string | undefined> => {
  const onKey = (event: KeyboardEvent): void => {
    const el = box.value;
    if (el === null || el.disabled || !on()) return;
    if (!focusChord.matches(event, el, focusChord.apple)) return;
    event.preventDefault();
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  };
  onMounted(() => {
    window.addEventListener('keydown', onKey);
  });
  onUnmounted(() => {
    window.removeEventListener('keydown', onKey);
  });
  return computed(() => (on() ? `${name} (${focusChord.label(focusChord.apple)})` : undefined));
};
