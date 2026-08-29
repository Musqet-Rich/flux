import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// Two entries: the app (index.html) and the service worker (src/sw.ts), which must land at a
// fixed, unhashed path because the app registers it by name and browsers update it by URL.
//
// The dev server proxies what the relay serves besides the PWA itself (`/ws/<room>` and
// `/healthz`, apps/relay/src/create-relay-server.ts) to a relay on FLUX_DEV_RELAY, so the app
// under HMR reaches its box through the page origin exactly as the built app does.
const devRelay = process.env['FLUX_DEV_RELAY'] ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/ws': { target: devRelay, ws: true },
      '/healthz': { target: devRelay },
    },
  },
  build: {
    rolldownOptions: {
      input: { main: 'index.html', sw: 'src/sw.ts' },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});
