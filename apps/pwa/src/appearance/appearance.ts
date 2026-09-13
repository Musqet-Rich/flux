import type { ComputedRef } from 'vue';
import { computed, reactive, readonly, ref } from 'vue';

import type { Theme } from './theme.ts';
import { theme as themes } from './theme.ts';

// How the app looks on this device (ADR 0030): light or dark, or whichever the system is in,
// the text size, and the theme, the colours each scheme paints in. All are the device's own,
// like its notification sound and send key, but unlike those they decide the first paint, so
// they are not in the store: the store's storage is IndexedDB, read after the app is on
// screen, and a light-scheme device would flash dark on every launch. They live in
// `localStorage`, read synchronously before the app mounts (app-appearance.ts, main.ts), and
// applied to the document by apply-appearance.ts.

export type Scheme = 'light' | 'dark';
export type Mode = 'system' | Scheme;

export interface AppearanceChoices {
  mode: Mode;
  // The root font size in CSS pixels; everything in the app is em- or rem-sized from it.
  fontSize: number;
  // `null` is the default theme: the stylesheet's own colours, nothing set on the root.
  theme: Theme | null;
}

export interface Appearance {
  choices: Readonly<AppearanceChoices>;
  // The scheme in force: the choice, or the system's while the choice is `system`.
  scheme: ComputedRef<Scheme>;
  setMode: (mode: Mode) => void;
  setFontSize: (px: number) => void;
  setTheme: (theme: Theme | null) => void;
}

// The slice of `window.localStorage` used; tests hand in a map.
export interface SyncStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

// The system's preference and a way to hear it change; `matchMedia` in the browser.
export interface SystemScheme {
  dark: boolean;
  onChange: (listener: (dark: boolean) => void) => void;
}

const storageKey = 'flux.appearance';

const modes: readonly Mode[] = ['system', 'light', 'dark'];

// The sizes the settings slider offers. The default is the size styles/base.css paints at
// before this runs; the two must agree or the page resizes on load.
const fontSize = { min: 12, max: 22, step: 1, default: 15 } as const;

const defaults: Readonly<AppearanceChoices> = {
  mode: 'system',
  fontSize: fontSize.default,
  theme: null,
};

const isMode = (value: unknown): value is Mode => modes.some((mode) => mode === value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// Whole pixels within the slider's range, so a hand-edited or stale value cannot shrink the
// app to nothing or blow it up.
const isFontSize = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= fontSize.min &&
  value <= fontSize.max;

// The theme is the one key a stored value may lack: devices that chose a scheme before there
// were themes stored none, and must not lose the choice to the upgrade.
const parseTheme = (value: Record<string, unknown>): Theme | null | undefined => {
  if (!('theme' in value) || value['theme'] === null) return null;
  const parsed = themes.fromValue(value['theme']);
  return parsed.ok ? parsed.theme : undefined;
};

// Anything stored that does not parse to the whole shape is ignored, not repaired: the
// defaults stand until the operator chooses again. Always a fresh object: the result becomes
// the reactive state, and a proxy writes through to what it wraps.
const parse = (text: string | null): AppearanceChoices => {
  if (text === null) return { ...defaults };
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) return { ...defaults };
    const { mode, fontSize: size } = value;
    const theme = parseTheme(value);
    if (!isMode(mode) || !isFontSize(size) || theme === undefined) return { ...defaults };
    return { mode, fontSize: size, theme };
  } catch {
    return { ...defaults };
  }
};

const create = (storage: SyncStorage, system: SystemScheme): Appearance => {
  const choices = reactive<AppearanceChoices>(parse(storage.getItem(storageKey)));
  const systemDark = ref(system.dark);
  // Never unregistered: there is one appearance for the page's life.
  system.onChange((dark) => {
    systemDark.value = dark;
  });
  // The default theme is stored as no key at all, the shape a device from before themes wrote.
  const save = (): void => {
    const { mode, fontSize: size, theme } = choices;
    storage.setItem(
      storageKey,
      JSON.stringify(theme === null ? { mode, fontSize: size } : choices),
    );
  };
  return {
    choices: readonly(choices),
    scheme: computed(() => {
      if (choices.mode !== 'system') return choices.mode;
      return systemDark.value ? 'dark' : 'light';
    }),
    setMode: (mode) => {
      choices.mode = mode;
      save();
    },
    setFontSize: (px) => {
      if (!isFontSize(px)) return;
      choices.fontSize = px;
      save();
    },
    setTheme: (theme) => {
      choices.theme = theme;
      save();
    },
  };
};

export const appearance: {
  modes: readonly Mode[];
  fontSize: typeof fontSize;
  isMode: typeof isMode;
  create: typeof create;
} = { modes, fontSize, isMode, create };
