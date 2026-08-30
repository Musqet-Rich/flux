# Developing Flux

The rules, toolchain, TypeScript settings, style, testing and the definition of done are in [`docs/engineering.md`](docs/engineering.md) — read it before changing anything. What each part does and how the parts connect is in [`docs/architecture.md`](docs/architecture.md), and the wire contract is [`docs/protocol.md`](docs/protocol.md). This file is just the commands.

```sh
corepack pnpm install
corepack pnpm run check     # fmt, lint, typecheck, tests with coverage: the pre-commit gate
corepack pnpm run build     # daemon, relay, pwa, in dependency order
corepack pnpm --filter @flux/pwa dev
```

`corepack pnpm run check` is what the pre-commit hook enforces; it must pass before every commit. Node 24 only.

## Running from source

Run the daemon from source with `FLUX_RELAY_URL=http://127.0.0.1:8787 node apps/daemon/src/index.ts` (Node strips the types) against `node apps/relay/src/index.ts`. A plain `http://` relay is only accepted on loopback (`localhost`, `127.0.0.1`, `::1`); anywhere else the daemon refuses to start (`insecure_transport`) and the app refuses the pairing link, so a deployed relay is always `https://`. `apps/daemon/test/built-daemon.test.ts` builds the daemon into a temp dir and runs the result, so a broken production build fails `pnpm run check`.

## PWA with hot reload

To work on the PWA with hot reload, run the three parts in three terminals:

```sh
corepack pnpm run build && node apps/relay/dist/index.mjs                      # relay on :8787
FLUX_RELAY_URL=http://127.0.0.1:8787 FLUX_DATA_DIR=/tmp/flux-dev node apps/daemon/dist/index.mjs  # or apps/daemon/src/index.ts
corepack pnpm --filter @flux/pwa dev                                            # Vite on :5173
```

The dev server proxies `/ws` and `/healthz` to the relay (`FLUX_DEV_RELAY` overrides `http://127.0.0.1:8787`), so the app reaches the box through its own origin just like the built one. To pair, take the link the daemon prints at start-up on a terminal (or `FLUX_DATA_DIR=/tmp/flux-dev node apps/daemon/dist/index.mjs pair`; `pair` finds the running daemon through the control socket in that directory), which has origin `http://127.0.0.1:8787`, and open `http://localhost:5173/#<fragment>` with the same fragment; the app pairs from the fragment on load. Edits to components then hot-reload without dropping the paired connection. The service worker is not registered under the dev server, so there are no push notifications there.
