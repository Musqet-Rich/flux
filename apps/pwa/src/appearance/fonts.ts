// The families the app ships for text and for code (ADR 0030), the ones Settings offers and a
// theme may name: each has an @font-face in styles/fonts.css over a woff2 under public/fonts,
// and .github/scripts/check-fonts.sh refuses the lists here and the stylesheet's disagreeing.
// A theme may name a family the app does not ship, since the JSON is shared between devices
// that may run different versions; that falls back to the platform's own stack, the one
// styles/base.css paints with, rather than being refused: the rest of the theme still holds.
// The stacks are here rather than read from the stylesheet so that the property a theme sets
// is the whole value, a quoted family ahead of the platform's, and nothing but a family the
// app ships ever goes into it.

export type Part = 'text' | 'code';

export interface Fonts {
  text?: string;
  code?: string;
}

const parts: readonly Part[] = ['text', 'code'];

// In the order the pickers list them.
const families: Readonly<Record<Part, readonly string[]>> = {
  text: [
    'Atkinson Hyperlegible',
    'Exo',
    'Inter',
    'Newsreader',
    'Noto Serif',
    'Oldenburg',
    'Playpen Sans',
    'Roboto',
    'Sen',
    'Space Grotesk',
  ],
  code: [
    'Atkinson Hyperlegible Mono',
    'Cascadia Code',
    'Courier Prime',
    'Fragment Mono',
    'IBM Plex Mono',
    'JetBrains Mono',
    'Kode Mono',
    'Nova Mono',
    'Red Hat Mono',
    'Roboto Mono',
  ],
};

// The platform's own, exactly what styles/base.css sets, since the property is set over the
// stylesheet's on every launch and the two differing would change the font when nothing was
// chosen.
const platform: Readonly<Record<Part, string>> = {
  text: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  code: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const isShipped = (part: Part, family: string): boolean => families[part].includes(family);

// The font-family value for a part: the chosen family ahead of the platform's stack, which
// takes over for any character the family lacks, or the platform's alone when nothing was
// chosen or the family is not one the app ships.
const stack = (part: Part, family?: string): string =>
  family !== undefined && isShipped(part, family)
    ? `'${family}', ${platform[part]}`
    : platform[part];

export const fonts: {
  parts: readonly Part[];
  families: Readonly<Record<Part, readonly string[]>>;
  platform: Readonly<Record<Part, string>>;
  isShipped: typeof isShipped;
  stack: typeof stack;
} = { parts, families, platform, isShipped, stack };
