import { createApp } from 'vue';

import App from './App.vue';

createApp(App).mount('#app');

// The worker only handles push and notification taps (src/sw.ts, emitted as /sw.js by the
// build); a browser without it, or the dev server, simply gets no notifications.
if ('serviceWorker' in navigator) {
  try {
    await navigator.serviceWorker.register('/sw.js', { type: 'module' });
  } catch {
    // Registration failing is the browser's business; the app is complete without it.
  }
}
