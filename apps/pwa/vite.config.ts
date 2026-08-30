import { readFileSync } from 'node:fs';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// Two entries: the app (index.html) and the service worker (src/sw.ts), which must land at a
// fixed, unhashed path because the app registers it by name and browsers update it by URL.
//
// The dev server proxies what the relay serves besides the PWA itself (`/ws/<room>` and
// `/healthz`, apps/relay/src/create-relay-server.ts) to a relay on FLUX_DEV_RELAY, so the app
// under HMR reaches its box through the page origin exactly as the built app does.
const devRelay = process.env['FLUX_DEV_RELAY'] ?? 'http://127.0.0.1:8787';

// The single app version (ADR 0021), read from the root package.json and stamped into the build
// as `FLUX_VERSION` (src/version.ts reads it); the dev fallback covers `dev` and tests.
const readVersion = (): string => {
  const pkg: unknown = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  );
  return typeof pkg === 'object' &&
    pkg !== null &&
    'version' in pkg &&
    typeof pkg.version === 'string'
    ? pkg.version
    : '0.0.0';
};

export default defineConfig({
  plugins: [vue()],
  define: { FLUX_VERSION: JSON.stringify(readVersion()) },
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
        // CodeMirror is shared by the diff view (in main) and the lazily loaded file editor, so
        // it lands in a chunk of its own; named here, or it takes the name of whichever small
        // module of ours happens to sit between them (`editor-theme-*.js`, 250 kB). The
        // commands package is only the file editor's and stays in its lazy chunk.
        advancedChunks: {
          groups: [
            {
              name: 'codemirror',
              test: /node_modules[\\/]@(?:codemirror|lezer|marijn)[\\/](?!commands)/u,
            },
          ],
        },
      },
    },
  },
});
