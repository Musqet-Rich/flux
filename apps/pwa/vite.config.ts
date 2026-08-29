import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// Two entries: the app (index.html) and the service worker (src/sw.ts), which must land at a
// fixed, unhashed path because the app registers it by name and browsers update it by URL.
export default defineConfig({
  plugins: [vue()],
  build: {
    rolldownOptions: {
      input: { main: 'index.html', sw: 'src/sw.ts' },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});
