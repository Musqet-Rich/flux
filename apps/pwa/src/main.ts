import { createApp } from 'vue';

import App from './App.vue';
import { appAppearance } from './appearance/app-appearance.ts';
import { applyAppearance } from './appearance/apply-appearance.ts';

// The scheme and text size go on the document first, so the first paint is the device's choice
// and not the stylesheet's dark default (ADR 0030).
applyAppearance(document, appAppearance);
createApp(App).mount('#app');

// The worker only handles push and notification taps (src/sw.ts, emitted as /sw.js by the
// build); a browser without it simply gets no notifications. The dev server has no /sw.js
// (it would answer with index.html), so registration is skipped there rather than failed.
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  try {
    await navigator.serviceWorker.register('/sw.js', { type: 'module' });
  } catch {
    // Registration failing is the browser's business; the app is complete without it.
  }
}
