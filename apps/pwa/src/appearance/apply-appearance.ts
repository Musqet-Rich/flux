import { watch } from 'vue';

import type { Appearance } from './appearance.ts';
import { fonts } from './fonts.ts';
import { theme as themes } from './theme.ts';

// Puts the device's appearance on the document (ADR 0030) and keeps it there as it changes:
// the scheme as `data-scheme` on the root, which styles/base.css keys `color-scheme` on (the
// stylesheet alone follows the system, so the first paint is right before this runs), the
// theme as the colour custom properties on the root, over the stylesheet's, the fonts as the
// two stack properties beside them, and the text size as the root font size. The browser's
// own chrome follows too:
// `theme-color`, which a phone paints its status bar in, is set to the page background the
// scheme and theme came to; the body's resolved colour rather than the `--bg` token, whose
// value is a `light-dark()` call until it is used. Read on a scheme, theme or font change,
// never for the size: it forces a style recalculation, which a slider dragging the size
// should not pay for, while the other three are a pick each.
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
  const stopPaint = watch(
    () => ({
      scheme: appearance.scheme.value,
      theme: appearance.choices.theme,
      chosen: appearance.choices.fonts,
    }),
    ({ scheme, theme, chosen }) => {
      root.dataset['scheme'] = scheme;
      // Every property, every time, the default's included: a theme sets them all, with the
      // default's values where it said nothing, so none of a previous theme's can linger, and
      // Default is one more theme rather than a second path that takes them away. The fonts
      // the same: the platform stack where no family is chosen.
      const properties = { ...themes.css(theme ?? themes.default), ...fonts.css(chosen) };
      for (const [property, value] of Object.entries(properties)) {
        root.style.setProperty(property, value);
      }
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
    stopPaint();
  };
};
