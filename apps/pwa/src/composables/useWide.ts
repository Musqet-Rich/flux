import type { Ref } from 'vue';
import { onScopeDispose, ref } from 'vue';

// Whether the screen is wide enough for a side pane beside the chat (ADR 0033): 64rem of the
// browser's default font size, 1024px, since a media query's rem is the browser's and not the
// app's: a laptop, a desktop window or a tablet held sideways, never a phone. Read through the
// browser's media query so a window resized across the line switches layout live, and a
// runtime without `matchMedia` (a test's DOM) counts as narrow, the layout every screen has.

const query = '(min-width: 64rem)';

export const useWide = (): Ref<boolean> => {
  const wide = ref(false);
  if (typeof matchMedia !== 'function') return wide;
  const media = matchMedia(query);
  wide.value = media.matches;
  const onChange = (event: MediaQueryListEvent): void => {
    wide.value = event.matches;
  };
  media.addEventListener('change', onChange);
  onScopeDispose(() => {
    media.removeEventListener('change', onChange);
  });
  return wide;
};
