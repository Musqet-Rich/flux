import { watch } from 'vue';

import type { Appearance } from './appearance.ts';

// Puts the device's appearance on the document (ADR 0030) and keeps it there as it changes:
// the scheme as `data-scheme` on the root, which styles/base.css keys `color-scheme` on (the
// stylesheet alone follows the system, so the first paint is right before this runs), and the
// text size as the root font size. The browser's own chrome follows too: `theme-color`, which
// a phone paints its status bar in, is set to the page background the scheme came to; the
// body's resolved colour rather than the `--bg` token, whose value is a `light-dark()` call
// until it is used. Read on a scheme change only: it forces a style recalculation, which a
// slider dragging the size should not pay for.
//
// Run before the app mounts, so the first paint is already right.

export const applyAppearance = (doc: Document, appearance: Appearance): (() => void) => {
  const root = doc.documentElement;
  const metas = doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  const stopSize = watch(
    () => appearance.choices.fontSize,
    (px) => {
      root.style.fontSize = `${px}px`;
    },
    { immediate: true },
  );
  const stopScheme = watch(
    () => appearance.scheme.value,
    (scheme) => {
      root.dataset['scheme'] = scheme;
      // Transparent where no stylesheet is loaded (a test); the metas then keep their markup
      // values.
      const bg = doc.defaultView?.getComputedStyle(doc.body).backgroundColor ?? '';
      if (bg === '' || bg === 'rgba(0, 0, 0, 0)') return;
      for (const meta of metas) meta.content = bg;
    },
    { immediate: true },
  );
  return () => {
    stopSize();
    stopScheme();
  };
};
