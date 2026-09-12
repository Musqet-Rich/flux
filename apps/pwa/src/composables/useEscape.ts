import type { Ref } from 'vue';
import { onScopeDispose, watch } from 'vue';

// Escape closes a sheet, a modal or a popup from wherever the focus is: a button, the composer
// behind it or, in the help modal, nowhere while its textarea is disabled during a send. So the
// closers listen on the document, one listener among them, and the one registered last, the
// thing on top (the help modal over a rename sheet, the menu reopened over it), is the only one
// an Escape closes. Consumed (`preventDefault`), so the session screen's Esc, which stops the
// agent (SessionView), lets it pass; and an Escape already consumed below, by the composer's
// slash list, or cancelling an IME composition, closes nothing. A closer is live for the
// component's life, or, given `open`, while that is true (useDismiss); registered from setup,
// which runs parent before child, so a closer nested in another sits above it.

const closers: (() => void)[] = [];

const onKey = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
  const top = closers.at(-1);
  if (top === undefined) return;
  event.preventDefault();
  top();
};

const register = (close: () => void): void => {
  if (closers.length === 0) document.addEventListener('keydown', onKey);
  closers.push(close);
};

const unregister = (close: () => void): void => {
  const at = closers.lastIndexOf(close);
  if (at >= 0) closers.splice(at, 1);
  if (closers.length === 0) document.removeEventListener('keydown', onKey);
};

export const useEscape = (close: () => void, open?: Ref<boolean>): void => {
  if (open === undefined) register(close);
  else {
    watch(
      open,
      (on) => {
        if (on) register(close);
        else unregister(close);
      },
      { immediate: true },
    );
  }
  onScopeDispose(() => {
    unregister(close);
  });
};
