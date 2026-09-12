import type { Ref } from 'vue';
import { onMounted, onScopeDispose, watch } from 'vue';

// Sizes a textarea to its text: one line when empty, a line more for each the text takes, up
// to `maxLines`, past which the box scrolls inside. The browser's own drag handle is off (the
// caller's CSS) since the box sizes itself. Done here rather than with `field-sizing: content`
// because Safari has no such thing, and the phone is the first screen this runs on. Measured
// from the box's own computed style, so a font or padding change moves the cap with it: the
// height is reset to `auto` for `scrollHeight` to report the text's height, then pinned to
// that or the cap, whichever is less. Runs after each change of the text, which covers a
// keystroke, a paste, a slash-command pick and another session's draft coming in, and on a
// window resize, since a narrower box wraps to more lines.

// A computed length is always in px; anything else (`normal`, or nothing) counts as none.
const px = (value: string): number => (value.endsWith('px') ? Number(value.slice(0, -2)) : 0);

// A `line-height: normal` reports as the word, not a length; 1.2 is what browsers use for it.
const lineHeight = (style: CSSStyleDeclaration): number => {
  const line = px(style.lineHeight);
  return line > 0 ? line : px(style.fontSize) * 1.2;
};

export const useAutoGrow = (
  box: Ref<HTMLTextAreaElement | null>,
  text: () => string,
  maxLines = 10,
): void => {
  const fit = (): void => {
    const el = box.value;
    if (el === null) return;
    const style = getComputedStyle(el);
    const border = px(style.borderTopWidth) + px(style.borderBottomWidth);
    const cap =
      lineHeight(style) * maxLines + px(style.paddingTop) + px(style.paddingBottom) + border;
    // The measure at `auto` is a forced layout in which the box, and so its row, is as tall as
    // the whole text. WebKit clamps a sibling scroller's `scrollTop` to that transient size
    // (Chromium defers the clamp), which pulled the timeline above it off its tail by a line
    // per line typed. Holding the row at its height for the measure keeps the layout still
    // until the one real change below.
    const row = el.parentElement;
    if (row !== null) row.style.height = `${row.getBoundingClientRect().height}px`;
    el.style.height = 'auto';
    // `scrollHeight` is the text plus padding; the border-box height adds the border.
    const wanted = el.scrollHeight + border;
    el.style.height = `${Math.min(wanted, cap)}px`;
    el.style.overflowY = wanted > cap ? 'auto' : 'hidden';
    if (row !== null) row.style.height = '';
  };
  // After the DOM has the new value: the box measures what it shows.
  watch(text, fit, { flush: 'post' });
  onMounted(() => {
    fit();
    window.addEventListener('resize', fit);
  });
  onScopeDispose(() => {
    window.removeEventListener('resize', fit);
  });
};
