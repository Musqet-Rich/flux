import { fileURLToPath } from 'node:url';

import { createRelayServer } from './create-relay-server.ts';

// Entry point. Configuration is environment only (no config file on the relay):
//   FLUX_RELAY_PORT  listen port, default 8787
//   FLUX_RELAY_HOST  bind address, default 127.0.0.1 (a reverse proxy terminates TLS)
//   FLUX_PWA_DIR     built PWA to serve, default apps/pwa/dist beside this package
//   FLUX_TRUST_PROXY set to 1 behind a reverse proxy so the per-IP connection limit counts
//                    the address in X-Forwarded-For, not the proxy's (never inferred)

const env = process.env;
const port = Number(env['FLUX_RELAY_PORT'] ?? 8787);
const host = env['FLUX_RELAY_HOST'] ?? '127.0.0.1';
const pwaDir = env['FLUX_PWA_DIR'] ?? fileURLToPath(new URL('../../pwa/dist', import.meta.url));

const server = createRelayServer({ pwaDir, trustProxy: env['FLUX_TRUST_PROXY'] === '1' });
const bound = await server.listen(port, host);
console.log(`flux relay listening on ${host}:${bound}`);

const shutdown = (): void => {
  server
    .close()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
