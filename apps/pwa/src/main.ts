import { createApp } from 'vue';

import App from './App.vue';

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
