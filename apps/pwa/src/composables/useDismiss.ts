import type { Ref } from 'vue';
import { onScopeDispose, watch } from 'vue';

import { useEscape } from './useEscape.ts';

// Closes a popup (a `role="menu"` list, the image overlay) the way the platform's own do:
// Escape (useEscape, live while `open`, so the newest popup is the one it closes and the key is
// consumed), or a tap anywhere outside `root`. The tap listener exists only while `open` is
// true, on the document so a tap on another bubble's trigger closes this menu before opening
// that one; `pointerdown` rather than `click` so a tap that starts a scroll still dismisses.

export const useDismiss = (open: Ref<boolean>, root: Ref<HTMLElement | null>): void => {
  const close = (): void => {
    open.value = false;
  };
  const onPointer = (event: PointerEvent): void => {
    const inside = event.target instanceof Node && (root.value?.contains(event.target) ?? false);
    if (!inside) close();
  };
  const detach = (): void => {
    document.removeEventListener('pointerdown', onPointer);
  };
  useEscape(close, open);
  watch(open, (on) => {
    if (on) document.addEventListener('pointerdown', onPointer);
    else detach();
  });
  onScopeDispose(detach);
};
