import type { Ref } from 'vue';
import { onScopeDispose, watch } from 'vue';

// Closes a popup (a `role="menu"` list) the way the platform's own do: Escape, or a tap
// anywhere outside `root`. The listeners exist only while `open` is true, on the document so
// a tap on another bubble's trigger closes this menu before opening that one; `pointerdown`
// rather than `click` so a tap that starts a scroll still dismisses.

export const useDismiss = (
  open: Ref<boolean>,
  root: Ref<HTMLElement | null>,
  target: Document = document,
): void => {
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') open.value = false;
  };
  const onPointer = (event: PointerEvent): void => {
    const inside = event.target instanceof Node && (root.value?.contains(event.target) ?? false);
    if (!inside) open.value = false;
  };
  const detach = (): void => {
    target.removeEventListener('keydown', onKey);
    target.removeEventListener('pointerdown', onPointer);
  };
  watch(open, (on) => {
    if (on) {
      target.addEventListener('keydown', onKey);
      target.addEventListener('pointerdown', onPointer);
    } else {
      detach();
    }
  });
  onScopeDispose(detach);
};
