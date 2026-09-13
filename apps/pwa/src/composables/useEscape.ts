import type { Ref } from 'vue';
import { onScopeDispose, watch } from 'vue';

import { escapeStack } from '../components/escape-stack.ts';

// Escape closes a sheet, a modal or a popup from wherever the focus is: a button, the composer
// behind it or, in the help modal, nowhere while its textarea is disabled during a send. So the
// closers listen on the document, one listener among them (components/escape-stack.ts), and the one
// registered last, the thing on top (the help modal over a rename sheet, the menu reopened over
// it), is the only one an Escape closes. Consumed (`preventDefault`), so the session screen's
// Esc, which stops the agent (SessionView), lets it pass; and an Escape already consumed below,
// by the composer's slash list, or cancelling an IME composition, closes nothing. A closer is
// live for the component's life, or, given `open`, while that is true (useDismiss); registered
// from setup, which runs parent before child, so a closer nested in another sits above it.

export const useEscape = (close: () => void, open?: Ref<boolean>): void => {
  if (open === undefined) escapeStack.register(close);
  else {
    watch(
      open,
      (on) => {
        if (on) escapeStack.register(close);
        else escapeStack.unregister(close);
      },
      { immediate: true },
    );
  }
  onScopeDispose(() => {
    escapeStack.unregister(close);
  });
};
