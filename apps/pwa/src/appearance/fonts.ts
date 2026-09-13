// The families the app ships for text and for code (ADR 0030), the ones Settings offers and a
// theme may name: each has an @font-face in styles/fonts.css over a woff2 under public/fonts,
// and .github/scripts/check-fonts.sh refuses the lists here and the stylesheet's disagreeing.
// The choice is the device's, kept beside the theme (appearance.ts) rather than inside it, so
// that picking a preset and picking a family are the two controls they look like; it rides in
// the theme JSON for sharing, folded in by Copy and taken out by Paste. A shared theme may
// name a family the app does not ship, since the device it came from may run another version;
// that falls back to the platform's own stack, the one styles/base.css paints with, rather than
// being refused: the rest of the theme still holds. The stacks are here rather than read from
// the stylesheet so that the property set on the root is the whole value, a quoted family
// ahead of the platform's, and nothing but a family the app ships ever goes into it.

export type Part = 'text' | 'code';

export interface Fonts {
  text?: string;
  code?: string;
}

export interface ReadFonts {
  ok: true;
  fonts: Fonts;
}

export interface RefusedFonts {
  ok: false;
  reason: string;
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

// A family is what a picker shows; a paste is the one place a length nobody typed can come
// from.
const familyLength = 64;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPart = (key: string): key is Part => parts.some((part) => part === key);

const refused = (reason: string): RefusedFonts => ({ ok: false, reason });

// The `fonts` of a theme's JSON, or of the stored choices: the two families, any name so long
// as it is one, in the fixed order text then code.
const read = (value: unknown): ReadFonts | RefusedFonts => {
  if (!isRecord(value)) return refused('fonts must be an object: {"text": ..., "code": ...}');
  const given: Fonts = {};
  for (const [key, family] of Object.entries(value)) {
    if (!isPart(key)) return refused(`fonts.${key.slice(0, 32)} is not a part: text, code`);
    const words = typeof family === 'string' ? family.trim() : '';
    if (words === '' || words.length > familyLength) {
      return refused(`fonts.${key} must be a family name`);
    }
    given[key] = words;
  }
  const fonts: Fonts = {};
  for (const part of parts) {
    const family = given[part];
    if (family !== undefined) fonts[part] = family;
  }
  return { ok: true, fonts };
};

const isShipped = (part: Part, family: string): boolean => families[part].includes(family);

// The font-family value for a part: the chosen family ahead of the platform's stack, which
// takes over for any character the family lacks, or the platform's alone when nothing was
// chosen or the family is not one the app ships.
const stack = (part: Part, family?: string): string =>
  family !== undefined && isShipped(part, family)
    ? `'${family}', ${platform[part]}`
    : platform[part];

// The two custom properties the choice sets on the root, over the stylesheet's own.
const css = (chosen: Fonts): Record<string, string> => ({
  '--font-text': stack('text', chosen.text),
  '--font-code': stack('code', chosen.code),
});

export const fonts: {
  parts: readonly Part[];
  families: Readonly<Record<Part, readonly string[]>>;
  platform: Readonly<Record<Part, string>>;
  read: typeof read;
  isShipped: typeof isShipped;
  stack: typeof stack;
  css: typeof css;
} = { parts, families, platform, read, isShipped, stack, css };
