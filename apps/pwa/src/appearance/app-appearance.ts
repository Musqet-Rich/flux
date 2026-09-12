import type { SyncStorage, SystemScheme } from './appearance.ts';
import { appearance } from './appearance.ts';

// The browser's appearance (ADR 0030): `localStorage` and the `prefers-color-scheme` media
// query. Built at import so main.ts can apply it before the app mounts; app-store.ts hands it
// to the store, which is how views reach it, and tests build their own with `appearance.create`.

// Storage that a browser refuses (a locked-down private mode) reads as nothing chosen and
// forgets each choice at once; the app is complete without it.
const storage: SyncStorage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Nothing to do: the choice applies for this page's life.
    }
  },
};

const query = matchMedia('(prefers-color-scheme: dark)');
const system: SystemScheme = {
  dark: query.matches,
  onChange: (listener) => {
    query.addEventListener('change', (event) => {
      listener(event.matches);
    });
  },
};

export const appAppearance = appearance.create(storage, system);
